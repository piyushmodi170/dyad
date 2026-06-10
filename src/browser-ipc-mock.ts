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

  return {
    selectedModel: { name: modelName, provider },
    providerSettings: {
      anthropic: anthropicKey ? { apiKey: anthropicKey } : {},
      openai: openaiKey ? { apiKey: openaiKey } : {},
      google: googleKey ? { apiKey: googleKey } : {},
      openrouter: {},
      xai: {},
      auto: {},
    } as Record<string, Record<string, unknown>>,
    selectedTemplateId: "react-vite",
    enableAutoUpdate: false,
    releaseChannel: "stable",
    enableDyadPro: false,
  };
}

const STORAGE_KEY = "dyad-browser-ipc-settings";

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge env-seeded defaults with persisted settings so env keys work too
      const defaults = buildDefaultSettings();
      return {
        ...defaults,
        ...parsed,
        providerSettings: {
          ...defaults.providerSettings,
          ...(parsed.providerSettings ?? {}),
        },
      };
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
}

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
): Promise<string> {
  const allMessages = [...history, { role: "user", content: newPrompt }];
  const contents = allMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const safeModel = model || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      generationConfig: { maxOutputTokens: 8192 },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: { message: resp.statusText } }));
    throw new Error((err as any)?.error?.message ?? resp.statusText);
  }

  const data = await resp.json();
  return (data as any).candidates?.[0]?.content?.parts?.[0]?.text ?? "(empty response)";
}

async function callOpenAI(
  apiKey: string,
  model: string,
  history: { role: string; content: string }[],
  newPrompt: string,
): Promise<string> {
  const messages = [
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: newPrompt },
  ];

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
): Promise<string> {
  const messages = [
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: newPrompt },
  ];

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: model || "claude-sonnet-4-5", messages, max_tokens: 8192 }),
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
): Promise<string> {
  const messages = [
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: newPrompt },
  ];

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

  try {
    // Add user message to store
    const userMsg = makeMessage(chatId, "user", prompt);
    addMessage(userMsg);

    // Get history BEFORE this message for the AI call
    const history = getChatMessages(chatId).filter((m) => m.id !== userMsg.id);

    // Emit a chunk with the user message so the UI shows it immediately
    fireEvent("chat:response:chunk", {
      chatId,
      messages: getChatMessages(chatId).map(stripChatId),
    });

    // Make the real AI call
    const aiText = await callAI(chatId, prompt, history);

    // Add assistant message to store
    const assistantMsg = makeMessage(chatId, "assistant", aiText);
    addMessage(assistantMsg);

    // Update chat title on first message
    const chat = _chats.get(chatId);
    if (chat && chat.title === "New Chat") {
      chat.title = prompt.slice(0, 60) + (prompt.length > 60 ? "…" : "");
    }

    // Emit final chunk with all messages
    fireEvent("chat:response:chunk", {
      chatId,
      messages: getChatMessages(chatId).map(stripChatId),
    });

    // Emit end event
    fireEvent("chat:response:end", {
      chatId,
      updatedFiles: false,
      totalTokens: Math.round((prompt.length + aiText.length) / 4),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    fireEvent("chat:response:error", { chatId, error: message });
  } finally {
    fireEvent("chat:stream:end", { chatId });
  }
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
      files: [],
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
    return { app, chatId: chat.id };
  },

  "get-app": (appId: unknown) => {
    const app = _apps.get(appId as number);
    if (!app) return null;
    return { ...app, files: [], frameworkType: null, supabaseProjectName: null, vercelTeamSlug: null };
  },

  "delete-app": (params: unknown) => {
    const { appId } = params as { appId: number };
    _apps.delete(appId);
    return null;
  },

  "delete-apps": (params: unknown) => {
    const { appIds } = params as { appIds: number[] };
    const results = appIds.map((appId) => {
      _apps.delete(appId);
      return { appId, success: true };
    });
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
    return { app: copy, chatId: chat.id };
  },

  "rename-app": (params: unknown) => {
    const { appId, name } = params as { appId: number; name: string };
    const app = _apps.get(appId);
    if (app) { app.name = name; app.updatedAt = new Date(); }
    return null;
  },

  "run-app": null,
  "stop-app": null,
  "restart-app": null,
  "search-app": [],
  "check-app-name": { available: true },
  "change-app-location": null,
  "select-app-location": null,
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
    return chat.id;
  },

  "update-chat": null,
  "delete-chat": (chatId: unknown) => { _chats.delete(chatId as number); return null; },
  "delete-messages": (chatId: unknown) => { _messagesByChatId.set(chatId as number, []); return null; },
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
  "select-app-folder": { path: null, name: null },
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
  "get-user-budget": null,
  "system:get-user-budget": null,
  "window:minimize": null,
  "window:maximize": null,
  "window:close": null,
  "window:focus": null,

  // ── Env / debug ───────────────────────────────────────────────────────────
  "get-env-vars": {},
  "get-app-env-vars": {},
  "set-app-env-vars": null,
  "get-session-debug-bundle": null,
  "add-log": null,
  "clear-logs": null,
  "renderer:error-toast-ready": null,
  "check-problems": { problems: [] },
  "portal:migrate-create": null,

  // ── GitHub ────────────────────────────────────────────────────────────────
  "github:list-repos": [],
  "github:get-user": null,
  "github:create-repo": null,
  "github:push": null,

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

  // ── Versions ─────────────────────────────────────────────────────────────
  "versions:list": [],
  "versions:checkout": null,

  // ── Checkout (Dyad Pro) ───────────────────────────────────────────────────
  "checkout:get-version": null,
};

// =============================================================================
// Mock IPC implementation
// =============================================================================

function mockInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  if (Object.prototype.hasOwnProperty.call(CHANNEL_DEFAULTS, channel)) {
    const val = CHANNEL_DEFAULTS[channel];
    const result = typeof val === "function" ? (val as Function)(...args) : val;
    return Promise.resolve(result);
  }
  console.debug(`[browser-ipc-mock] unhandled channel: ${channel}`);
  return Promise.resolve(null);
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

  console.info(
    "[browser-ipc-mock] Electron IPC not available — installed browser mock. " +
      "AI features require API keys configured in Settings.",
  );
}
