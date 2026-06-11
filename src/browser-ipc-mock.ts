/**
 * Browser IPC mock — runs in place of Electron's ipcRenderer when the app
 * is served directly in a browser (Replit preview, web deployment, etc.).
 *
 * Features:
 * - Persistent in-memory stores for apps, chats, messages
 * - Real event emitter so streaming works correctly
 * - Live AI API calls (Google, OpenAI, Anthropic) using configured keys
 * - Proper return shapes matching all Zod schemas
 */

import { MODEL_OPTIONS } from "./ipc/shared/language_model_constants";

declare const __REPLIT_ANTHROPIC_KEY__: string;
declare const __REPLIT_OPENAI_KEY__: string;
declare const __REPLIT_GOOGLE_KEY__: string;

// =============================================================================
// Helpers
// =============================================================================

function safeKey(val: string | undefined): { value: string; encryptionType: "plaintext" } | undefined {
  if (!val) return undefined;
  return { value: val, encryptionType: "plaintext" };
}

function getEnvKey(name: string): string | undefined {
  try {
    const map: Record<string, () => string | undefined> = {
      __REPLIT_ANTHROPIC_KEY__: () =>
        typeof __REPLIT_ANTHROPIC_KEY__ !== "undefined" ? __REPLIT_ANTHROPIC_KEY__ : undefined,
      __REPLIT_OPENAI_KEY__: () =>
        typeof __REPLIT_OPENAI_KEY__ !== "undefined" ? __REPLIT_OPENAI_KEY__ : undefined,
      __REPLIT_GOOGLE_KEY__: () =>
        typeof __REPLIT_GOOGLE_KEY__ !== "undefined" ? __REPLIT_GOOGLE_KEY__ : undefined,
    };
    return map[name]?.();
  } catch {
    return undefined;
  }
}

// =============================================================================
// Default settings (bootstrapped from env keys if present)
// =============================================================================

function buildDefaultSettings() {
  const anthropicKey = safeKey(getEnvKey("__REPLIT_ANTHROPIC_KEY__"));
  const openaiKey = safeKey(getEnvKey("__REPLIT_OPENAI_KEY__"));
  const googleKey = safeKey(getEnvKey("__REPLIT_GOOGLE_KEY__"));

  const provider = anthropicKey ? "anthropic" : openaiKey ? "openai" : googleKey ? "google" : "anthropic";
  const modelName =
    provider === "anthropic"
      ? "claude-sonnet-4-5"
      : provider === "openai"
        ? "gpt-4o"
        : "gemini-flash-latest";

  const defaults = {
    selectedModel: { name: modelName, provider },
    providerSettings: {
      anthropic: anthropicKey ? { apiKey: anthropicKey } : {},
      openai: openaiKey ? { apiKey: openaiKey } : {},
      google: googleKey ? { apiKey: googleKey } : {},
      openrouter: {},
      xai: {},
      // Fake auto key so hasDyadProKey() returns true — unlocks Pro UI in browser mode
      // (browser mock never routes calls to the auto/managed provider)
      auto: { apiKey: { value: "browser-mode-pro-unlocked" } },
    } as Record<string, Record<string, unknown>>,
    selectedTemplateId: "react-vite",
    enableAutoUpdate: false,
    releaseChannel: "stable",
    enableDyadPro: true,
  };
  return defaults;
}

const STORAGE_KEY = "dyad-browser-ipc-settings";

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge env-seeded defaults with persisted settings so env keys work too
      const defaults = buildDefaultSettings();
      const merged = {
        ...defaults,
        ...parsed,
        providerSettings: {
          ...defaults.providerSettings,
          ...(parsed.providerSettings ?? {}),
        },
      };
      // Always keep Pro enabled regardless of stored value
      merged.enableDyadPro = true;
      merged.providerSettings.auto = defaults.providerSettings.auto;
      return merged;
    }
  } catch {
    // ignore corrupted storage
  }
  return buildDefaultSettings();
}

function saveSettings(s: typeof _currentSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore storage errors
  }
}

let _currentSettings = loadSettings();

// =============================================================================
// In-memory stores
// =============================================================================

let _nextId = 1;
function nextId() { return _nextId++; }

interface StoredApp {
  id: number;
  name: string;
  path: string;
  resolvedPath: string;
  createdAt: Date;
  updatedAt: Date;
  githubOrg: null;
  githubRepo: null;
  githubBranch: null;
  supabaseProjectId: null;
  supabaseParentProjectId: null;
  supabaseOrganizationSlug: null;
  neonProjectId: null;
  neonDevelopmentBranchId: null;
  neonPreviewBranchId: null;
  neonActiveBranchId: null;
  selectedDatabaseBranchType: null;
  vercelProjectId: null;
  vercelProjectName: null;
  vercelDeploymentUrl: null;
  vercelTeamId: null;
  installCommand: null;
  startCommand: null;
  isFavorite: boolean;
  collectionId: null;
}

interface StoredChat {
  id: number;
  appId: number;
  title: string;
  createdAt: Date;
  chatMode: null;
}

interface StoredMessage {
  id: number;
  chatId: number;
  role: "user" | "assistant";
  content: string;
  approvalState: null;
  commitHash: null;
  sourceCommitHash: null;
  dbTimestamp: null;
  requestId: null;
  totalTokens: null;
  model: null;
  createdAt: Date;
}

const _apps = new Map<number, StoredApp>();
const _chats = new Map<number, StoredChat>();
const _messagesByChatId = new Map<number, StoredMessage[]>();

let _pendingImportFiles: File[] = [];

// =============================================================================
// GitHub helpers (browser mode)
// =============================================================================

const GITHUB_CLIENT_ID_BROWSER = "Ov23liWV2HdC0RBLecWx";
const GITHUB_SCOPES_BROWSER = "repo,user,workflow";

function getGithubToken(): string | null {
  return (_currentSettings as Record<string, unknown> & { githubAccessToken?: { value: string } }).githubAccessToken?.value ?? null;
}

function githubAuthHeaders(): Record<string, string> {
  const token = getGithubToken();
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

let _githubPollTimer: ReturnType<typeof setTimeout> | null = null;

function stopGithubPoll() {
  if (_githubPollTimer !== null) {
    clearTimeout(_githubPollTimer);
    _githubPollTimer = null;
  }
}

// =============================================================================
// Browser virtual filesystem — stores AI-generated files per app
// =============================================================================

const _appFiles = new Map<number, Map<string, string>>();

function getAppFileMap(appId: number): Map<string, string> {
  let map = _appFiles.get(appId);
  if (!map) {
    map = new Map();
    _appFiles.set(appId, map);
  }
  return map;
}

/** Browser-safe parser for <dyad-write path="..."> tags */
function parseBrowserDyadWriteTags(response: string): Array<{ path: string; content: string }> {
  const regex = /<dyad-write([^>]*)>([\s\S]*?)<\/dyad-write>/gi;
  const pathAttr = /\bpath="([^"]+)"/;
  const results: Array<{ path: string; content: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(response)) !== null) {
    const attrStr = match[1];
    const pathMatch = pathAttr.exec(attrStr);
    if (!pathMatch) continue;
    let content = match[2].trim();
    const lines = content.split("\n");
    if (lines[0]?.startsWith("```")) lines.shift();
    if (lines[lines.length - 1]?.startsWith("```")) lines.pop();
    content = lines.join("\n");
    results.push({ path: pathMatch[1], content });
  }
  return results;
}

// =============================================================================
// System prompt for browser mode — tells AI to use dyad-write tags
// =============================================================================

const BROWSER_SYSTEM_PROMPT = `You are Dyad, an expert full-stack AI app builder. You build COMPLETE, PRODUCTION-READY applications — never mockups, placeholders, or black screens.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TECHNICAL CONSTRAINT (browser preview)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your output renders as a self-contained blob URL in an iframe.
• ALL code must live inside one index.html (no separate .js/.jsx/.css files via src/href).
• Load libraries from CDN only — local relative paths do NOT work.
• Use <script type="text/babel"> for JSX — Babel standalone transpiles it in-browser.
• NEVER use <script type="module"> or ES import/export.
• CDN URLs that work: https://unpkg.com/..., https://cdn.tailwindcss.com, https://cdn.jsdelivr.net/npm/...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MANDATORY QUALITY STANDARDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ NEVER produce: simple static pages, black screens, placeholder content, "coming soon" text, broken buttons, or incomplete features.
✅ ALWAYS produce: fully working multi-page apps where every button, form, and interaction does something real.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  HOW TO SIMULATE FULL-STACK IN BROWSER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Since there is no server, simulate backend logic entirely in JavaScript:

DATABASE → Use localStorage for persistence. Create helper functions:
  const DB = {
    get: (key) => JSON.parse(localStorage.getItem(key) || '[]'),
    set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
  };

AUTHENTICATION → Store user session in localStorage. Show login/signup forms, validate credentials, set/clear session.

REST APIs → Replace fetch() calls with synchronous localStorage reads/writes wrapped in async functions so the code structure looks like a real API layer:
  async function getUsers() { return DB.get('users'); }
  async function createUser(data) { const users = DB.get('users'); users.push({id: Date.now(), ...data}); DB.set('users', users); return data; }

REAL-TIME / WEBSOCKETS → Use setInterval and React state to simulate live updates, streaming chat responses, notifications, etc.

AI RESPONSES → Simulate streaming AI output with setInterval that appends words one by one to a message state variable.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  WHAT TO BUILD FOR EVERY APP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Build the FULL application the user asked for. Default to including:

FRONTEND (React 18 + Tailwind + React Router)
• Multi-page navigation using React state-based routing (since React Router CDN can be complex, use a useState('page') pattern)
• Responsive desktop + mobile layout with a sidebar/navbar
• Dashboard with real data from localStorage + charts (Chart.js)
• Authentication (login / signup / logout) with form validation
• Settings page with working toggles and saves to localStorage
• All CRUD operations fully wired up (create, read, update, delete)
• Loading states, error states, empty states — all handled

BACKEND SIMULATION
• A clean "API layer" with async functions that use localStorage
• Proper data schemas (users, items, messages, etc. with IDs and timestamps)
• Input validation and error handling
• Role-based access (admin vs user) checked from session

USEFUL PAGES TO INCLUDE (pick what's relevant to the request):
• /dashboard — analytics, stats, charts, recent activity
• /auth — login + signup tabs with validation
• /chat — ChatGPT-style chat with streaming simulation and message history
• /settings — profile, preferences, API keys, all saveable
• /admin — user list, management actions
• /[feature] — whatever the user specifically asked for

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AI-AGENT / SKILLS PLATFORM APPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When the user asks for an "AI platform", "agent system", "skills marketplace", or anything similar, you MUST build these as fully working features (not labels):

MULTI-AGENT SYSTEM (an Agents page):
• A Supervisor agent that receives a task and delegates sub-tasks to specialized agents.
• Specialized agents: Research, Coding, Sales, Marketing, Support, Automation, Planning.
• Render each agent as a card showing name, role, and live status (idle → working → done).
• When the user submits a task, simulate the Supervisor splitting it and each agent "working" via setInterval, updating statuses and a shared activity/collaboration log in real time.
• A live task queue with progress bars and per-task status.

SKILLS SYSTEM (a Skills page + Marketplace):
• Create Skill (form), Edit Skill, Delete Skill — full CRUD, persisted in localStorage.
• Import Skill (read an uploaded .json file via FileReader) and Export Skill (download as .json via Blob).
• Skill Marketplace: a grid of installable skills with categories/filtering.
• Skill Categories, Skill Versioning (bump version on edit), Skill Permissions (toggle), Skill Sharing (copy a share link/code).
• Each skill is an object: { id, name, description, category, version, permissions, code }.

These must be REAL: buttons save/delete/import/export actual data, agents visibly change status, the marketplace installs into "My Skills". No placeholders.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  REQUIRED CDN STACK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Always load these unless not needed:
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
Add as needed:
• Charts: <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
• Icons: <script src="https://unpkg.com/lucide@latest"></script>  (use lucide.createIcons() after render)
• Markdown: <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
• Animations: <script src="https://cdn.jsdelivr.net/npm/framer-motion@11/dist/framer-motion.js"></script>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FILE FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<dyad-write path="index.html">
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>App Title</title>
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>/* global styles */</style>
</head>
<body class="bg-gray-950 text-white">
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect, useRef, useCallback } = React;

    // ── Database layer (localStorage) ──────────────────────────────
    const DB = {
      get: (k, def=[]) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
      set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
    };

    // ── Seed data if empty ─────────────────────────────────────────
    if (!DB.get('seeded', false)) {
      DB.set('users', [{ id: 1, name: 'Admin', email: 'admin@app.com', role: 'admin', password: 'admin123' }]);
      DB.set('seeded', true);
    }

    // ── App components ────────────────────────────────────────────
    // ... (full implementation)

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>
</dyad-write>

Rules:
• Wrap ALL file content in <dyad-write path="..."> tags.
• Write COMPLETE code — no "// TODO", no "// rest of code here", no ellipsis.
• Every feature must be implemented. Every button must do something.
• Use <think>...</think> to plan the full app before writing code.
• Seed localStorage with realistic demo data so the app feels alive immediately.`;

function makeApp(name: string): StoredApp {
  const id = nextId();
  const now = new Date();
  const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
  return {
    id,
    name,
    path: `/dyad-apps/${safeName}`,
    resolvedPath: `/dyad-apps/${safeName}`,
    createdAt: now,
    updatedAt: now,
    githubOrg: null, githubRepo: null, githubBranch: null,
    supabaseProjectId: null, supabaseParentProjectId: null, supabaseOrganizationSlug: null,
    neonProjectId: null, neonDevelopmentBranchId: null, neonPreviewBranchId: null, neonActiveBranchId: null,
    selectedDatabaseBranchType: null,
    vercelProjectId: null, vercelProjectName: null, vercelDeploymentUrl: null, vercelTeamId: null,
    installCommand: null, startCommand: null,
    isFavorite: false, collectionId: null,
  };
}

function makeChat(appId: number, title = "New Chat"): StoredChat {
  return { id: nextId(), appId, title, createdAt: new Date(), chatMode: null };
}

function makeMessage(chatId: number, role: "user" | "assistant", content: string): StoredMessage {
  return {
    id: nextId(), chatId, role, content,
    approvalState: null, commitHash: null, sourceCommitHash: null,
    dbTimestamp: null, requestId: null, totalTokens: null, model: null,
    createdAt: new Date(),
  };
}

function getChatMessages(chatId: number): StoredMessage[] {
  return _messagesByChatId.get(chatId) ?? [];
}

function addMessage(msg: StoredMessage) {
  const list = _messagesByChatId.get(msg.chatId) ?? [];
  list.push(msg);
  _messagesByChatId.set(msg.chatId, list);
  saveData();
}

// =============================================================================
// Persistence — save/load all in-memory state via PostgreSQL API
// =============================================================================

// Key kept for one-time localStorage → PostgreSQL migration only
const LS_MIGRATION_KEY = "dyad-browser-ipc-data";

// Resolves once the initial data load from the API is complete.
// mockInvoke awaits this so no call is dispatched with stale empty state.
let _dataReady: Promise<void>;

function buildSerializedState() {
  return {
    nextId: _nextId,
    apps: Array.from(_apps.entries()).map(([id, app]) => [
      id,
      { ...app, createdAt: app.createdAt.toISOString(), updatedAt: app.updatedAt.toISOString() },
    ]),
    chats: Array.from(_chats.entries()).map(([id, chat]) => [
      id,
      { ...chat, createdAt: chat.createdAt.toISOString() },
    ]),
    messagesByChatId: Array.from(_messagesByChatId.entries()).map(([chatId, msgs]) => [
      chatId,
      msgs.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    ]),
    appFiles: Array.from(_appFiles.entries()).map(([appId, fileMap]) => [
      appId,
      Array.from(fileMap.entries()),
    ]),
  };
}

type SerializedState = ReturnType<typeof buildSerializedState>;

function applySerializedState(data: SerializedState): void {
  if (typeof data.nextId === "number") _nextId = data.nextId;
  for (const [id, app] of (data.apps ?? []) as Array<[number, Record<string, unknown>]>) {
    _apps.set(Number(id), {
      ...(app as object),
      createdAt: new Date(app.createdAt as string),
      updatedAt: new Date(app.updatedAt as string),
    } as StoredApp);
  }
  for (const [id, chat] of (data.chats ?? []) as Array<[number, Record<string, unknown>]>) {
    _chats.set(Number(id), {
      ...(chat as object),
      createdAt: new Date(chat.createdAt as string),
    } as StoredChat);
  }
  for (const [chatId, msgs] of (data.messagesByChatId ?? []) as Array<[number, Array<Record<string, unknown>>]>) {
    _messagesByChatId.set(Number(chatId), msgs.map((m) => ({
      ...(m as object),
      createdAt: new Date(m.createdAt as string),
    } as StoredMessage)));
  }
  for (const [appId, fileEntries] of (data.appFiles ?? []) as Array<[number, Array<[string, string]>]>) {
    _appFiles.set(Number(appId), new Map(fileEntries));
  }
}

function saveData(): void {
  const state = buildSerializedState();
  fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  }).catch((e) => {
    console.warn("[browser-ipc-mock] Failed to save state to PostgreSQL:", e);
  });
}

async function initLoadData(): Promise<void> {
  try {
    const res = await fetch("/api/state");
    if (!res.ok) throw new Error(`API responded ${res.status}`);
    const data: SerializedState | null = await res.json();
    if (data) {
      applySerializedState(data);
      console.debug(`[browser-ipc-mock] Loaded ${_apps.size} apps, ${_chats.size} chats from PostgreSQL`);
      // Remove old localStorage data now that we're on PostgreSQL
      try { localStorage.removeItem(LS_MIGRATION_KEY); } catch { /* ignore */ }
      return;
    }
    // API returned null — check localStorage for one-time migration
    const raw = localStorage.getItem(LS_MIGRATION_KEY);
    if (raw) {
      applySerializedState(JSON.parse(raw) as SerializedState);
      console.info(`[browser-ipc-mock] Migrated ${_apps.size} apps, ${_chats.size} chats from localStorage → PostgreSQL`);
      saveData();
      localStorage.removeItem(LS_MIGRATION_KEY);
    }
  } catch (e) {
    console.warn("[browser-ipc-mock] API not available, falling back to localStorage:", e);
    try {
      const raw = localStorage.getItem(LS_MIGRATION_KEY);
      if (raw) applySerializedState(JSON.parse(raw) as SerializedState);
    } catch { /* ignore */ }
  }
}

_dataReady = initLoadData();

// =============================================================================
// Event emitter (enables chat:stream events to fire back to listeners)
// =============================================================================

const _eventListeners = new Map<string, Set<(data: unknown) => void>>();

function fireEvent(channel: string, data: unknown): void {
  const listeners = _eventListeners.get(channel);
  if (!listeners) return;
  for (const fn of listeners) {
    try { fn(data); } catch (e) { console.error("[browser-ipc-mock] event listener error", e); }
  }
}

// =============================================================================
// Provider / model catalog
// =============================================================================

const CLOUD_PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic",
    type: "cloud",
    hasFreeTier: false,
    websiteUrl: "https://console.anthropic.com/settings/keys",
    gatewayPrefix: "anthropic/",
    envVarName: "ANTHROPIC_API_KEY",
  },
  {
    id: "google",
    name: "Google",
    type: "cloud",
    hasFreeTier: true,
    websiteUrl: "https://aistudio.google.com/app/apikey",
    gatewayPrefix: "gemini/",
    envVarName: "GEMINI_API_KEY",
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "cloud",
    hasFreeTier: false,
    websiteUrl: "https://platform.openai.com/api-keys",
    gatewayPrefix: "",
    envVarName: "OPENAI_API_KEY",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    type: "cloud",
    hasFreeTier: true,
    websiteUrl: "https://openrouter.ai/settings/keys",
    gatewayPrefix: "openrouter/",
    envVarName: "OPENROUTER_API_KEY",
  },
  {
    id: "xai",
    name: "xAI",
    type: "cloud",
    hasFreeTier: false,
    websiteUrl: "https://console.x.ai/",
    gatewayPrefix: "xai/",
    envVarName: "XAI_API_KEY",
    secondary: true,
  },
];

function getApiKeyForProvider(providerId: string): string | null {
  const ps = _currentSettings.providerSettings?.[providerId];
  if (!ps) return null;
  const k = (ps as Record<string, unknown>).apiKey as { value: string } | undefined;
  return k?.value ?? null;
}

function getModelsByProviders(): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  for (const provider of CLOUD_PROVIDERS) {
    const key = getApiKeyForProvider(provider.id);
    if (!key) continue;
    const models = MODEL_OPTIONS[provider.id];
    if (models && models.length > 0) {
      result[provider.id] = models.map((m) => ({
        apiName: m.name,
        displayName: m.displayName,
        description: m.description,
        dollarSigns: m.dollarSigns,
        temperature: m.temperature,
        maxOutputTokens: m.maxOutputTokens,
        contextWindow: m.contextWindow,
        type: "cloud",
      }));
    }
  }
  return result;
}

// =============================================================================
// AI API calls (browser-safe: Google supports CORS; others may not)
// =============================================================================

async function callAI(chatId: number, prompt: string, existingMessages: StoredMessage[]): Promise<string> {
  const { provider, name: modelName } = _currentSettings.selectedModel as { provider: string; name: string };
  const apiKey = getApiKeyForProvider(provider);

  if (!apiKey) {
    // Find any provider that does have a key and suggest it
    const configuredProvider = CLOUD_PROVIDERS.find((p) => getApiKeyForProvider(p.id));
    if (configuredProvider) {
      return `⚠️ No API key for "${provider}". But you have ${configuredProvider.name} configured — switch to it in the model picker (bottom of chat).`;
    }
    return `⚠️ No AI provider is configured yet. Go to ⚙️ Settings → Click "Setup Google Gemini API Key" (free) → paste your key → Save Key. Then come back and try again.`;
  }

  const history = existingMessages.map((m) => ({ role: m.role, content: m.content }));

  try {
    if (provider === "google") {
      return await callGoogleAI(apiKey, modelName, history, prompt);
    } else if (provider === "openai") {
      return await callOpenAI(apiKey, modelName, history, prompt);
    } else if (provider === "anthropic") {
      return await callAnthropic(apiKey, modelName, history, prompt);
    } else if (provider === "openrouter") {
      return await callOpenRouter(apiKey, modelName, history, prompt);
    } else {
      return `⚠️ Provider "${provider}" is not yet supported in browser mode. Try Google (free tier available) or OpenAI.`;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `⚠️ AI API error: ${msg}`;
  }
}

async function callGoogleAI(
  apiKey: string,
  model: string,
  history: { role: string; content: string }[],
  newPrompt: string,
  systemPrompt?: string,
): Promise<string> {
  const allMessages = [...history, { role: "user", content: newPrompt }];
  const contents = allMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const safeModel = model || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = { contents, generationConfig: { maxOutputTokens: 8192 } };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: { message: resp.statusText } }));
    throw new Error((err as any)?.error?.message ?? resp.statusText);
  }

  const data = await resp.json();
  return (data as any).candidates?.[0]?.content?.parts?.[0]?.text ?? "(empty response)";
}

/** Real SSE streaming for Google Gemini — fires onChunk with accumulated text */
async function callGoogleAIStreaming(
  apiKey: string,
  model: string,
  history: { role: string; content: string }[],
  newPrompt: string,
  onChunk: (accumulated: string) => void,
  systemPrompt?: string,
): Promise<void> {
  const allMessages = [...history, { role: "user", content: newPrompt }];
  const contents = allMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const safeModel = model || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:streamGenerateContent?key=${apiKey}&alt=sse`;

  const body: Record<string, unknown> = { contents, generationConfig: { maxOutputTokens: 8192 } };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: { message: resp.statusText } }));
    throw new Error((err as any)?.error?.message ?? resp.statusText);
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // keep the incomplete last line

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const chunk: string = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (chunk) {
          accumulated += chunk;
          onChunk(accumulated);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  // Process any remaining buffer
  if (buffer.startsWith("data: ")) {
    const jsonStr = buffer.slice(6).trim();
    if (jsonStr && jsonStr !== "[DONE]") {
      try {
        const parsed = JSON.parse(jsonStr);
        const chunk: string = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (chunk) {
          accumulated += chunk;
          onChunk(accumulated);
        }
      } catch { /* ignore */ }
    }
  }

  if (!accumulated) {
    onChunk("(empty response from AI)");
  }
}

async function callOpenAI(
  apiKey: string,
  model: string,
  history: { role: string; content: string }[],
  newPrompt: string,
  systemPrompt?: string,
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push(...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
  messages.push({ role: "user", content: newPrompt });

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: model || "gpt-4o", messages }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: { message: resp.statusText } }));
    throw new Error((err as any)?.error?.message ?? resp.statusText);
  }

  const data = await resp.json();
  return (data as any).choices?.[0]?.message?.content ?? "(empty response)";
}

async function callAnthropic(
  apiKey: string,
  model: string,
  history: { role: string; content: string }[],
  newPrompt: string,
  systemPrompt?: string,
): Promise<string> {
  const messages = [
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: newPrompt },
  ];

  const body: Record<string, unknown> = { model: model || "claude-sonnet-4-5", messages, max_tokens: 16000 };
  if (systemPrompt) body.system = systemPrompt;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: { message: resp.statusText } }));
    throw new Error((err as any)?.error?.message ?? resp.statusText);
  }

  const data = await resp.json();
  return (data as any).content?.[0]?.text ?? "(empty response)";
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  history: { role: string; content: string }[],
  newPrompt: string,
  systemPrompt?: string,
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push(...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
  messages.push({ role: "user", content: newPrompt });

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": window.location.origin,
    },
    body: JSON.stringify({ model: model || "openrouter/free", messages }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: { message: resp.statusText } }));
    throw new Error((err as any)?.error?.message ?? resp.statusText);
  }

  const data = await resp.json();
  return (data as any).choices?.[0]?.message?.content ?? "(empty response)";
}

// =============================================================================
// chat:stream handler — makes real AI calls and fires events back
// =============================================================================

async function handleChatStream(params: unknown): Promise<void> {
  const { chatId, prompt } = params as { chatId: number; prompt: string };

  // Announce stream start
  fireEvent("chat:stream:start", { chatId });

  // Add user message to store
  const userMsg = makeMessage(chatId, "user", prompt);
  addMessage(userMsg);

  // Update chat title on first message
  const chat = _chats.get(chatId);
  if (chat && chat.title === "New Chat") {
    chat.title = prompt.slice(0, 60) + (prompt.length > 60 ? "…" : "");
  }

  // Feed the current codebase to the AI so it can edit existing code / fix bugs
  const codebaseContext = buildCodebaseContext(chat?.appId);
  const fullPrompt = codebaseContext
    ? `${codebaseContext}\n━━━ USER REQUEST ━━━\n${prompt}`
    : prompt;

  // Emit chunk with the user message immediately so it appears in UI
  fireEvent("chat:response:chunk", {
    chatId,
    messages: getChatMessages(chatId).map(stripChatId),
  });

  // Create a placeholder assistant message that we'll fill in as tokens stream
  const assistantMsg = makeMessage(chatId, "assistant", "");
  addMessage(assistantMsg);

  const { provider, name: modelName } = _currentSettings.selectedModel as { provider: string; name: string };
  const apiKey = getApiKeyForProvider(provider);

  try {
    if (!apiKey) {
      const configuredProvider = CLOUD_PROVIDERS.find((p) => getApiKeyForProvider(p.id));
      if (configuredProvider) {
        assistantMsg.content = `⚠️ No API key for "${provider}". But you have ${configuredProvider.name} configured — switch to it in the model picker (bottom of chat).`;
      } else {
        assistantMsg.content = `⚠️ No AI provider is configured yet. Go to ⚙️ Settings → Click "Setup Google Gemini API Key" (free) → paste your key → Save Key. Then come back and try again.`;
      }
      fireEvent("chat:response:chunk", {
        chatId,
        messages: getChatMessages(chatId).map(stripChatId),
      });
    } else {
      // Get history BEFORE this user message and the placeholder assistant message
      const history = getChatMessages(chatId).filter(
        (m) => m.id !== userMsg.id && m.id !== assistantMsg.id,
      );

      const onChunk = (text: string) => {
        assistantMsg.content = text;
        fireEvent("chat:response:chunk", {
          chatId,
          messages: getChatMessages(chatId).map(stripChatId),
        });
      };

      const sysPrompt = BROWSER_SYSTEM_PROMPT;

      if (provider === "google") {
        await callGoogleAIStreaming(apiKey, modelName, history, fullPrompt, onChunk, sysPrompt);
      } else if (provider === "openai") {
        const text = await callOpenAI(apiKey, modelName, history, fullPrompt, sysPrompt);
        simulateStreaming(text, onChunk);
      } else if (provider === "anthropic") {
        const text = await callAnthropic(apiKey, modelName, history, fullPrompt, sysPrompt);
        simulateStreaming(text, onChunk);
      } else if (provider === "openrouter") {
        const text = await callOpenRouter(apiKey, modelName, history, fullPrompt, sysPrompt);
        simulateStreaming(text, onChunk);
      } else {
        assistantMsg.content = `⚠️ Provider "${provider}" is not yet supported in browser mode. Try Google (free tier available).`;
        fireEvent("chat:response:chunk", {
          chatId,
          messages: getChatMessages(chatId).map(stripChatId),
        });
      }
    }

    // Parse dyad-write tags from the final response and store into virtual filesystem
    const chat2 = _chats.get(chatId);
    const appId = chat2?.appId;
    let updatedFiles = false;
    if (appId) {
      const writtenFiles = parseBrowserDyadWriteTags(assistantMsg.content);
      if (writtenFiles.length > 0) {
        const fileMap = getAppFileMap(appId);
        for (const { path, content } of writtenFiles) {
          fileMap.set(path, content);
        }
        updatedFiles = true;
        saveData();
      }
    }

    fireEvent("chat:response:end", {
      chatId,
      updatedFiles,
      totalTokens: Math.round((prompt.length + assistantMsg.content.length) / 4),
    });

    // After stream ends, try to extract HTML and create a live blob URL preview
    trySetHtmlPreview(chatId, assistantMsg.content);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    assistantMsg.content = `⚠️ Error: ${message}`;
    fireEvent("chat:response:chunk", {
      chatId,
      messages: getChatMessages(chatId).map(stripChatId),
    });
    fireEvent("chat:response:error", { chatId, error: message });
  } finally {
    fireEvent("chat:stream:end", { chatId });
  }
}

/** Simulate streaming for non-SSE providers by emitting word-by-word chunks */
function simulateStreaming(fullText: string, onChunk: (accumulated: string) => void) {
  const words = fullText.split(/(\s+)/);
  let accumulated = "";
  for (const word of words) {
    accumulated += word;
    onChunk(accumulated);
  }
}

/**
 * Builds a context block of the app's current files so the AI can SEE the existing
 * code and edit it / fix bugs instead of starting from scratch every time.
 */
function buildCodebaseContext(appId: number | undefined): string {
  if (!appId) return "";
  const fileMap = _appFiles.get(appId);
  if (!fileMap || fileMap.size === 0) return "";

  const TOTAL_BUDGET = 100000; // ~25k tokens — keep the prompt within model limits
  const PER_FILE_CAP = 24000;
  // Prioritize index.html (the entry point) so it's never the file that gets dropped
  const entries = [...fileMap.entries()].sort(([a], [b]) =>
    a === "index.html" ? -1 : b === "index.html" ? 1 : 0,
  );

  let ctx =
    "━━━ CURRENT CODEBASE (these files already exist — modify them to fix bugs or add features) ━━━\n";
  let used = 0;
  for (const [path, content] of entries) {
    if (used >= TOTAL_BUDGET) {
      ctx += `\n<file path="${path}">…(omitted — context budget reached)…</file>\n`;
      continue;
    }
    const body =
      content.length > PER_FILE_CAP ? content.slice(0, PER_FILE_CAP) + "\n…(truncated)…" : content;
    ctx += `\n<file path="${path}">\n${body}\n</file>\n`;
    used += body.length;
  }
  ctx +=
    "\nWhen the user asks to change, fix, or improve the app, RE-WRITE the relevant file(s) above with <dyad-write>, keeping all working features intact. Output the COMPLETE updated file, not a diff.\n";
  return ctx;
}

/**
 * Extracts HTML from an AI response and injects it as a blob-URL preview
 * so the preview panel shows the rendered result instead of "Waiting for server logs".
 */
function trySetHtmlPreview(chatId: number, aiResponse: string) {
  const chat = _chats.get(chatId);
  if (!chat) return;
  const appId = chat.appId;

  // Try to extract HTML from dyad-write tags first (Dyad's native format)
  let html: string | null = null;

  // Check virtual filesystem for index.html first
  if (appId) {
    const fileMap = _appFiles.get(appId);
    if (fileMap) {
      const indexHtml = fileMap.get("index.html");
      if (indexHtml) {
        html = indexHtml;
      }
    }
  }

  // Also scan the raw response for dyad-write tags (path attribute, not filename)
  if (!html) {
    const dyadWriteMatch = aiResponse.match(
      /<dyad-write[^>]*\spath="([^"]*\.html)"[^>]*>([\s\S]*?)<\/dyad-write>/i,
    );
    if (dyadWriteMatch) {
      html = dyadWriteMatch[2].trim();
    }
  }

  // Legacy: filename attribute
  if (!html) {
    const legacyMatch = aiResponse.match(
      /<dyad-write[^>]*filename="[^"]*\.html"[^>]*>([\s\S]*?)<\/dyad-write>/i,
    );
    if (legacyMatch) {
      html = legacyMatch[1].trim();
    }
  }

  // Fallback: look for HTML/markdown code blocks
  if (!html) {
    const codeBlockMatch = aiResponse.match(/```(?:html)?\s*\n([\s\S]*?)\n```/i);
    if (codeBlockMatch && codeBlockMatch[1].trim().startsWith("<")) {
      html = codeBlockMatch[1].trim();
    }
  }

  // Fallback: if the whole response looks like an HTML document
  if (!html && aiResponse.trim().startsWith("<!DOCTYPE html")) {
    html = aiResponse.trim();
  }

  if (!html) return;

  publishHtmlPreview(appId, html);
}

/**
 * Inlines local virtual-filesystem references into an HTML document, wraps it in a
 * blob URL, and fires the app:output event so the preview renders it live.
 * Shared by the chat-stream preview and the manual file-edit live refresh.
 */
function publishHtmlPreview(appId: number | undefined, rawHtml: string) {
  let html = rawHtml;

  // Ensure it's a full HTML document
  if (!html.includes("<html") && !html.includes("<!DOCTYPE")) {
    html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body>${html}</body></html>`;
  }

  // Inline any local file references from the virtual filesystem so blob URLs work.
  // CDN URLs (https://...) are left untouched — only local ./path references are replaced.
  if (appId) {
    const fileMap = _appFiles.get(appId);
    if (fileMap) {
      const resolve = (ref: string) => {
        if (/^https?:\/\/|^\/\//.test(ref)) return null; // CDN — skip
        const key = ref.replace(/^\.\//, "");
        return fileMap.get(key) ?? fileMap.get(ref) ?? null;
      };

      // <link rel="stylesheet" href="./styles.css"> → <style>…</style>
      html = html.replace(
        /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
        (match, href) => {
          const content = resolve(href);
          return content != null ? `<style>${content}</style>` : match;
        },
      );
      // also handle href-before-rel order
      html = html.replace(
        /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*\/?>/gi,
        (match, href) => {
          const content = resolve(href);
          return content != null ? `<style>${content}</style>` : match;
        },
      );

      // <script src="./app.js"></script> → <script>…</script>
      html = html.replace(
        /<script([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/gi,
        (match, before, src, after) => {
          const content = resolve(src);
          if (content == null) return match;
          // Preserve any type attribute (e.g. type="text/babel") but drop src
          const attrs = (before + after)
            .replace(/\bsrc=["'][^"']*["']/gi, "")
            .trim();
          return `<script${attrs ? " " + attrs : ""}>${content}</script>`;
        },
      );
    }
  }

  try {
    // Revoke the previous blob URL for this app to avoid leaking one per edit
    const prevKey = appId ?? -1;
    const prev = _lastBlobUrls.get(prevKey);
    if (prev) {
      try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
    }

    const blob = new Blob([html], { type: "text/html" });
    const blobUrl = URL.createObjectURL(blob);
    _lastBlobUrls.set(prevKey, blobUrl);

    // Fire the event that useRunApp listens for to set the preview URL
    setTimeout(() => {
      fireEvent("app:output", {
        type: "info",
        message: `[dyad-proxy-server]started=[${blobUrl}]original=[${blobUrl}]mode=[host]`,
        appId,
        timestamp: Date.now(),
      });
    }, 150);
  } catch {
    // Blob URLs not supported — silently skip
  }
}

/** Tracks the latest blob URL per app so the previous one can be revoked on refresh */
const _lastBlobUrls = new Map<number, string>();

/**
 * Rebuilds the live preview from the app's current virtual filesystem.
 * Called after a manual file edit so the preview updates in real time (Replit-style).
 */
function refreshPreviewForApp(appId: number | undefined) {
  if (!appId) return;
  const fileMap = _appFiles.get(appId);
  if (!fileMap) return;
  const indexHtml = fileMap.get("index.html");
  if (!indexHtml) return;
  publishHtmlPreview(appId, indexHtml);
}

/**
 * Handles run-app / restart-app (Rebuild). Builds a live blob-URL preview from the
 * app's current files. If no index.html exists yet, shows a gentle hint instead of
 * a hard "not available" error so the preview never gets stuck in an error state.
 */
function runAppPreview(appId: number | undefined) {
  if (!appId) return;
  const fileMap = _appFiles.get(appId);
  const indexHtml = fileMap?.get("index.html");

  if (indexHtml) {
    publishHtmlPreview(appId, indexHtml);
    return;
  }

  // No HTML entry point yet — render a friendly placeholder so the preview panel
  // doesn't hang on "Connecting to app…" (and never show a hard error).
  const placeholder = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;
       background:#0b0f19;color:#e5e7eb;text-align:center;padding:24px}
  .card{max-width:420px}
  .emoji{font-size:48px;margin-bottom:12px}
  h1{font-size:20px;margin:0 0 8px;font-weight:600}
  p{font-size:14px;line-height:1.5;color:#9ca3af;margin:0}
</style></head>
<body><div class="card">
  <div class="emoji">✨</div>
  <h1>No preview yet</h1>
  <p>Ask Dyad to build something in the chat. It generates a self-contained app that renders here live — and updates in real time as you edit.</p>
</div></body></html>`;
  publishHtmlPreview(appId, placeholder);
}

function stripChatId(m: StoredMessage) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    approvalState: m.approvalState,
    commitHash: m.commitHash,
    sourceCommitHash: m.sourceCommitHash,
    dbTimestamp: m.dbTimestamp,
    requestId: m.requestId,
    totalTokens: m.totalTokens,
    model: m.model,
    createdAt: m.createdAt,
  };
}

// =============================================================================
// IPC channel handlers
// =============================================================================

const CHANNEL_DEFAULTS: Record<string, unknown | ((...args: unknown[]) => unknown)> = {
  // ── Settings ─────────────────────────────────────────────────────────────
  "get-user-settings": () => _currentSettings,
  "set-user-settings": (newSettings: unknown) => {
    if (newSettings && typeof newSettings === "object") {
      const ns = newSettings as Record<string, unknown>;
      // Deep-merge providerSettings so individual provider keys are not wiped
      const mergedProviderSettings = { ..._currentSettings.providerSettings };
      if (ns.providerSettings && typeof ns.providerSettings === "object") {
        for (const [pid, pval] of Object.entries(ns.providerSettings as Record<string, unknown>)) {
          mergedProviderSettings[pid] = {
            ...(mergedProviderSettings[pid] as Record<string, unknown> ?? {}),
            ...(pval as Record<string, unknown> ?? {}),
          };
        }
      }
      _currentSettings = {
        ..._currentSettings,
        ...ns,
        providerSettings: mergedProviderSettings,
      } as typeof _currentSettings;
      saveSettings(_currentSettings);
    }
    return _currentSettings;
  },

  // ── Apps ─────────────────────────────────────────────────────────────────
  "list-apps": () => ({
    apps: Array.from(_apps.values()).map((a) => ({
      ...a,
      files: Array.from(_appFiles.get(a.id)?.keys() ?? []),
      frameworkType: null,
      supabaseProjectName: null,
      vercelTeamSlug: null,
    })),
  }),

  "create-app": (params: unknown) => {
    const p = params as { name?: string } | undefined;
    const name = p?.name ?? "My App";
    const app = makeApp(name);
    _apps.set(app.id, app);
    const chat = makeChat(app.id);
    _chats.set(chat.id, chat);
    _messagesByChatId.set(chat.id, []);
    saveData();
    return { app, chatId: chat.id };
  },

  "get-app": (appId: unknown) => {
    const app = _apps.get(appId as number);
    if (!app) return null;
    return {
      ...app,
      files: Array.from(_appFiles.get(app.id)?.keys() ?? []),
      frameworkType: null,
      supabaseProjectName: null,
      vercelTeamSlug: null,
    };
  },

  "read-app-file": (params: unknown) => {
    const { appId, filePath } = params as { appId: number; filePath: string };
    const fileMap = _appFiles.get(appId);
    if (!fileMap) return null;
    return fileMap.get(filePath) ?? null;
  },

  "edit-app-file": (params: unknown) => {
    const { appId, filePath, content } = params as { appId: number; filePath: string; content: string };
    const fileMap = getAppFileMap(appId);
    fileMap.set(filePath, content);
    saveData();
    // Live-refresh the preview so manual code edits show instantly (Replit-style)
    refreshPreviewForApp(appId);
    return {};
  },

  "search-app-files": (params: unknown) => {
    const { appId, query } = params as { appId: number; query: string };
    const fileMap = _appFiles.get(appId);
    if (!fileMap) return { results: [] };
    const lowerQuery = query.toLowerCase();
    const results: Array<{ filePath: string; snippet: string; lineNumber: number }> = [];
    for (const [filePath, content] of fileMap.entries()) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          results.push({ filePath, snippet: lines[i].trim(), lineNumber: i + 1 });
          if (results.length >= 20) break;
        }
      }
      if (results.length >= 20) break;
    }
    return { results };
  },

  "delete-app": (params: unknown) => {
    const { appId } = params as { appId: number };
    _apps.delete(appId);
    saveData();
    return null;
  },

  "delete-apps": (params: unknown) => {
    const { appIds } = params as { appIds: number[] };
    const results = appIds.map((appId) => {
      _apps.delete(appId);
      return { appId, success: true };
    });
    saveData();
    return { results };
  },

  "copy-app": (params: unknown) => {
    const { appId } = params as { appId: number };
    const src = _apps.get(appId);
    if (!src) return null;
    const copy = makeApp(src.name + " (copy)");
    _apps.set(copy.id, copy);
    const chat = makeChat(copy.id);
    _chats.set(chat.id, chat);
    saveData();
    return { app: copy, chatId: chat.id };
  },

  "rename-app": (params: unknown) => {
    const { appId, name } = params as { appId: number; name: string };
    const app = _apps.get(appId);
    if (app) { app.name = name; app.updatedAt = new Date(); }
    saveData();
    return null;
  },

  "run-app": (params: unknown) => {
    const appId = (params as { appId: number }).appId;
    runAppPreview(appId);
    return null;
  },
  "stop-app": null,
  "restart-app": (params: unknown) => {
    const appId = (params as { appId: number }).appId;
    // The "Rebuild" button calls this — rebuild the live preview from current files
    runAppPreview(appId);
    return null;
  },
  "search-app": [],
  "change-app-location": null,
  "select-app-location": null,
  "select-app-for-preview": null,
  "get-cloud-sandbox-status": null,
  "app:get-current-commit-hash": null,
  "app:list-screenshots": [],
  "app:list-thumbnails": [],

  // ── App collections ───────────────────────────────────────────────────────
  "appCollections:list": [],
  "appCollections:create": null,
  "appCollections:update": null,
  "appCollections:delete": null,
  "appCollections:assignApps": null,

  // ── Language models ───────────────────────────────────────────────────────
  "get-language-model-providers": () => {
    return CLOUD_PROVIDERS.map((p) => {
      const key = getApiKeyForProvider(p.id);
      return { ...p, ...(key ? { apiKey: { value: key, encryptionType: "plaintext" } } : {}) };
    });
  },

  "get-language-models": () => [],

  "get-language-models-by-providers": () => getModelsByProviders(),

  "create-custom-language-model-provider": null,
  "edit-custom-language-model-provider": null,
  "delete-custom-language-model-provider": null,
  "create-custom-language-model": null,
  "delete-custom-language-model": null,
  "delete-custom-model": null,
  "local-models:list-ollama": { models: [] },
  "local-models:list-lmstudio": { models: [] },

  // ── Chats ─────────────────────────────────────────────────────────────────
  "get-chats": (appId: unknown) => {
    const aid = appId as number | undefined;
    const chats = Array.from(_chats.values())
      .filter((c) => !aid || c.appId === aid)
      .map((c) => ({ id: c.id, appId: c.appId, title: c.title, createdAt: c.createdAt, chatMode: c.chatMode }));
    return chats;
  },

  "get-chat": (chatId: unknown) => {
    const chat = _chats.get(chatId as number);
    if (!chat) return null;
    return {
      id: chat.id,
      appId: chat.appId,
      title: chat.title,
      messages: getChatMessages(chat.id).map(stripChatId),
      initialCommitHash: null,
      dbTimestamp: null,
      chatMode: null,
    };
  },

  "get-chat-metadata": (chatId: unknown) => {
    const chat = _chats.get(chatId as number);
    if (!chat) return null;
    return { id: chat.id, appId: chat.appId, title: chat.title, createdAt: chat.createdAt, chatMode: null };
  },

  "create-chat": (params: unknown) => {
    const appId = typeof params === "number" ? params : (params as { appId: number }).appId;
    const chat = makeChat(appId);
    _chats.set(chat.id, chat);
    _messagesByChatId.set(chat.id, []);
    saveData();
    return chat.id;
  },

  "update-chat": null,
  "delete-chat": (chatId: unknown) => { _chats.delete(chatId as number); saveData(); return null; },
  "delete-messages": (chatId: unknown) => { _messagesByChatId.set(chatId as number, []); saveData(); return null; },
  "search-chats": [],

  "chat:stream": (params: unknown) => {
    void handleChatStream(params);
    return null;
  },

  "chat:cancel": (_chatId: unknown) => true,
  "chat:response:ack": null,
  "chat:count-tokens": { totalTokens: 0, contextWindow: 200000 },

  // ── MCP ───────────────────────────────────────────────────────────────────
  "mcp:list-servers": [],
  "mcp:create-server": null,
  "mcp:update-server": null,
  "mcp:delete-server": null,
  "mcp:list-tools": { tools: [], status: "connected" },
  "mcp:get-tool-consents": [],
  "mcp:set-tool-consent": null,
  "mcp:start-oauth": null,
  "mcp:disconnect-oauth": null,
  "mcp:probe-callback-port": { port: 3000 },
  "mcp:probe-connection": { status: "ok", error: null },
  "mcp:is-oauth-storage-encrypted": { available: false },

  // ── Agent tools ───────────────────────────────────────────────────────────
  "agent-tool:get-tools": [],
  "agent-tool:set-consent": null,

  // ── System ────────────────────────────────────────────────────────────────
  "get-system-platform": "linux",
  "get-initial-load-telemetry-context": { isFirstSession: false },
  "get-system-debug-info": {
    platform: "linux",
    arch: "x64",
    version: "1.0.0",
    nodeVersion: typeof process !== "undefined" ? (process?.versions?.node ?? "22.0.0") : "22.0.0",
  },
  "get-app-version": { version: "1.2.0-beta.1" },
  "nodejs-status": {
    nodeVersion: "v24.13.0",
    pnpmVersion: "10.26.1",
    nodeDownloadUrl: "https://nodejs.org/en/download",
  },
  "install-pnpm": null,
  "select-node-folder": { path: null, canceled: true, selectedPath: null },
  "get-node-path": null,
  "reload-env-path": null,
  "select-app-folder": () => {
    return new Promise<{ path: string | null; name: string | null }>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;

      let settled = false;
      const settle = (val: { path: string | null; name: string | null }) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };

      input.onchange = () => {
        const files = input.files;
        if (!files || files.length === 0) {
          settle({ path: null, name: null });
          return;
        }
        const folderName =
          ((files[0] as File & { webkitRelativePath: string }).webkitRelativePath ?? "").split("/")[0] ||
          "imported-app";
        _pendingImportFiles = Array.from(files);
        settle({ path: `/__browser_import__/${folderName}`, name: folderName });
      };

      (input as HTMLInputElement & { oncancel?: () => void }).oncancel = () =>
        settle({ path: null, name: null });

      window.addEventListener(
        "focus",
        () => setTimeout(() => settle({ path: null, name: null }), 600),
        { once: true },
      );

      input.click();
    });
  },
  "get-custom-apps-folder": {
    path: "/home/user/dyad-apps",
    isPathAvailable: true,
    isPathDefault: true,
  },
  "select-custom-apps-folder": { path: null, canceled: true },
  "set-custom-apps-folder": null,
  "open-external-url": null,
  "show-item-in-folder": null,
  "open-file-path": null,
  "clear-session-data": null,
  "get-user-budget": {
    usedCredits: 0,
    totalCredits: 999999,
    budgetResetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    redactedUserId: "browser-user",
    isTrial: false,
  },
  "system:get-user-budget": {
    usedCredits: 0,
    totalCredits: 999999,
    budgetResetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    redactedUserId: "browser-user",
    isTrial: false,
  },
  "window:minimize": null,
  "window:maximize": null,
  "window:close": null,
  "window:focus": null,

  // ── Env / debug ───────────────────────────────────────────────────────────
  "get-env-vars": {},
  "get-app-env-vars": [],
  "set-app-env-vars": null,
  "get-session-debug-bundle": null,
  "add-log": null,
  "clear-logs": null,
  "renderer:error-toast-ready": null,
  "check-problems": { problems: [] },
  "portal:migrate-create": null,

  // ── GitHub ────────────────────────────────────────────────────────────────
  "github:get-user": async () => {
    const token = getGithubToken();
    if (!token) return null;
    try {
      const res = await fetch("https://api.github.com/user", { headers: githubAuthHeaders() });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },

  "github:start-flow": (params: unknown) => {
    const { appId } = (params ?? { appId: null }) as { appId: number | null };
    void appId;
    stopGithubPoll();

    fireEvent("github:flow-update", { message: "Requesting device code from GitHub..." });

    fetch("/github-proxy/device/code", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID_BROWSER, scope: GITHUB_SCOPES_BROWSER }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`GitHub responded with ${res.status}`);
        return res.json() as Promise<{
          device_code: string;
          user_code: string;
          verification_uri: string;
          interval?: number;
        }>;
      })
      .then((data) => {
        fireEvent("github:flow-update", {
          userCode: data.user_code,
          verificationUri: data.verification_uri,
          message: "Please authorize in your browser.",
        });

        let pollInterval = data.interval ?? 5;
        const deviceCode = data.device_code;

        const poll = () => {
          fetch("/github-proxy/access-token", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              client_id: GITHUB_CLIENT_ID_BROWSER,
              device_code: deviceCode,
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            }),
          })
            .then((r) => r.json() as Promise<{
              access_token?: string;
              error?: string;
              error_description?: string;
            }>)
            .then((tokenData) => {
              if (tokenData.access_token) {
                (_currentSettings as Record<string, unknown>).githubAccessToken = {
                  value: tokenData.access_token,
                  encryptionType: "plaintext",
                };
                saveSettings(_currentSettings);
                fireEvent("github:flow-success", { message: "Successfully connected!" });
              } else if (tokenData.error === "authorization_pending") {
                fireEvent("github:flow-update", { message: "Waiting for authorization..." });
                _githubPollTimer = setTimeout(poll, pollInterval * 1000);
              } else if (tokenData.error === "slow_down") {
                pollInterval += 5;
                fireEvent("github:flow-update", { message: `GitHub asked to slow down. Retrying in ${pollInterval}s…` });
                _githubPollTimer = setTimeout(poll, pollInterval * 1000);
              } else if (tokenData.error === "expired_token") {
                fireEvent("github:flow-error", { error: "Verification code expired. Please try again." });
              } else if (tokenData.error === "access_denied") {
                fireEvent("github:flow-error", { error: "Authorization denied by user." });
              } else {
                fireEvent("github:flow-error", {
                  error: tokenData.error_description || tokenData.error || "Unknown error from GitHub.",
                });
              }
            })
            .catch((err) => {
              fireEvent("github:flow-error", { error: `Poll error: ${err instanceof Error ? err.message : String(err)}` });
            });
        };

        _githubPollTimer = setTimeout(poll, pollInterval * 1000);
      })
      .catch((err) => {
        fireEvent("github:flow-error", {
          error: `Failed to start GitHub auth: ${err instanceof Error ? err.message : String(err)}`,
        });
      });

    return undefined;
  },

  "github:list-repos": async () => {
    const token = getGithubToken();
    if (!token) return [];
    try {
      const res = await fetch(
        "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator",
        { headers: githubAuthHeaders() },
      );
      if (!res.ok) return [];
      const repos = (await res.json()) as Array<{ name: string; full_name: string; private: boolean }>;
      return repos.map((r) => ({ name: r.name, full_name: r.full_name, private: r.private }));
    } catch {
      return [];
    }
  },

  "github:get-repo-branches": async (params: unknown) => {
    const { owner, repo } = params as { owner: string; repo: string };
    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/branches`,
        { headers: githubAuthHeaders() },
      );
      if (!res.ok) return [];
      return res.json();
    } catch {
      return [];
    }
  },

  "github:is-repo-available": { available: false },
  "github:create-repo": null,
  "github:push": null,
  "github:fetch": null,
  "github:pull": null,
  "github:rebase": null,
  "github:rebase-abort": null,
  "github:merge-abort": null,
  "github:rebase-continue": null,
  "github:list-local-branches": [],
  "github:list-remote-branches": [],
  "github:create-branch": null,
  "github:switch-branch": null,
  "github:delete-branch": null,
  "github:rename-branch": null,
  "github:merge-branch": null,
  "github:get-conflicts": [],
  "github:get-git-state": null,
  "git:get-uncommitted-files": () => [],
  "github:disconnect": (_params: unknown) => {
    (_currentSettings as Record<string, unknown>).githubAccessToken = undefined;
    saveSettings(_currentSettings);
    return null;
  },
  "github:list-collaborators": [],
  "github:invite-collaborator": null,
  "github:remove-collaborator": null,

  "github:clone-repo-from-url": async (params: unknown) => {
    const { url, appName } = params as { url: string; appName?: string };

    const match = url.match(/github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?\s*$/);
    if (!match) return { error: "Invalid GitHub URL. Expected format: https://github.com/owner/repo" };

    const [, owner, repo] = match;
    const name = appName || repo;

    try {
      const infoRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}`,
        { headers: githubAuthHeaders() },
      );
      if (!infoRes.ok) {
        const errData = (await infoRes.json()) as { message?: string };
        return { error: errData.message || `Could not access repository (${infoRes.status})` };
      }

      const app = makeApp(name);
      _apps.set(app.id, app);
      const chat = makeChat(app.id);
      _chats.set(chat.id, chat);
      _messagesByChatId.set(chat.id, []);
      saveData();

      return {
        app: {
          ...app,
          files: Array.from(_appFiles.get(app.id)?.keys() ?? []),
          frameworkType: null,
          supabaseProjectName: null,
          vercelTeamSlug: null,
        },
        hasAiRules: false,
      };
    } catch (err) {
      return { error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  "github:connect-existing-repo": null,

  // ── Supabase / Neon / Vercel ──────────────────────────────────────────────
  "supabase:list-organizations": [],
  "supabase:get-organization": null,
  "neon:list-projects": [],
  "vercel:list-projects": [],

  // ── Templates ─────────────────────────────────────────────────────────────
  "get-templates": [],
  "template:list": [],

  // ── Prompts ───────────────────────────────────────────────────────────────
  "prompts:list": [],
  "prompts:create": null,
  "prompts:update": null,
  "prompts:delete": null,

  // ── Themes ───────────────────────────────────────────────────────────────
  "get-themes": [],
  "get-custom-themes": [],
  "themes:list": [],
  "custom-themes:list": [],
  "custom-themes:create": null,
  "custom-themes:update": null,
  "custom-themes:delete": null,
  "create-custom-theme": null,
  "update-custom-theme": null,
  "delete-custom-theme": null,
  "get-theme-generation-model-options": [],
  "set-app-theme": null,
  "get-app-theme": null,
  "apply-app-template": null,

  // ── Media ─────────────────────────────────────────────────────────────────
  "list-all-media": [],

  // ── Free agent quota ──────────────────────────────────────────────────────
  "free-agent-quota:get-status": {
    messagesUsed: 0,
    messagesLimit: 999,
    isQuotaExceeded: false,
    windowStartTime: null,
    resetTime: null,
    hoursUntilReset: null,
  },

  // ── Versions / branches ───────────────────────────────────────────────────
  "versions:list": [],
  "versions:checkout": null,
  "list-versions": (_params: unknown) => [],
  "get-current-branch": (_params: unknown) => ({ branch: "main" }),
  "revert-version": null,
  "checkout-version": null,

  // ── Proposals ─────────────────────────────────────────────────────────────
  "get-proposal": (_params: unknown) => null,

  // ── Import ────────────────────────────────────────────────────────────────
  "import-app": (params: unknown) => {
    const p = params as { path: string; appName: string };
    const app = makeApp(p.appName ?? "Imported App");
    _apps.set(app.id, app);
    const chat = makeChat(app.id);
    _chats.set(chat.id, chat);
    _messagesByChatId.set(chat.id, []);
    saveData();
    return { appId: app.id, chatId: chat.id };
  },
  "check-app-name": (params: unknown) => {
    const { appName } = params as { appName: string };
    const exists = Array.from(_apps.values()).some(
      (a) => a.name.toLowerCase() === (appName ?? "").toLowerCase(),
    );
    return { exists };
  },
  "check-ai-rules": (_params: unknown) => ({ exists: false }),

  // ── Checkout (Dyad Pro) ───────────────────────────────────────────────────
  "checkout:get-version": null,
};

// =============================================================================
// Mock IPC implementation
// =============================================================================

async function mockInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  await _dataReady;
  if (Object.prototype.hasOwnProperty.call(CHANNEL_DEFAULTS, channel)) {
    const val = CHANNEL_DEFAULTS[channel];
    const result = typeof val === "function" ? (val as Function)(...args) : val;
    return result;
  }
  console.debug(`[browser-ipc-mock] unhandled channel: ${channel}`);
  return null;
}

function mockOn(channel: string, listener: (...args: unknown[]) => void): () => void {
  if (!_eventListeners.has(channel)) {
    _eventListeners.set(channel, new Set());
  }
  _eventListeners.get(channel)!.add(listener as (data: unknown) => void);
  return () => mockOff(channel, listener);
}

function mockOff(channel: string, listener: (...args: unknown[]) => void): void {
  _eventListeners.get(channel)?.delete(listener as (data: unknown) => void);
}

function mockSend(_channel: string, ..._args: unknown[]): void {
  // no-op
}

// =============================================================================
// Install
// =============================================================================

export function installBrowserIpcMock(): void {
  const win = window as typeof window & {
    electron?: {
      ipcRenderer?: {
        invoke: typeof mockInvoke;
        on: typeof mockOn;
        off: typeof mockOff;
        send: typeof mockSend;
      };
    };
  };

  if (win.electron?.ipcRenderer) {
    return;
  }

  win.electron = {
    ipcRenderer: {
      invoke: mockInvoke,
      on: mockOn,
      off: mockOff,
      send: mockSend,
    },
  };

  (win as typeof window & { __DYAD_BROWSER_MODE__?: boolean }).__DYAD_BROWSER_MODE__ = true;

  // Mark user as Pro in localStorage so isDyadProUser() returns true
  try {
    window.localStorage.setItem("dyadProStatus", "true");
  } catch {
    // ignore storage errors in sandboxed iframes
  }

  console.info(
    "[browser-ipc-mock] Electron IPC not available — installed browser mock. " +
      "AI features require API keys configured in Settings.",
  );
}
