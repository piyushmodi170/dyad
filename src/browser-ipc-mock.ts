/**
 * Browser IPC mock — runs in place of Electron's ipcRenderer when the app
 * is served directly in a browser (Replit preview, web deployment, etc.).
 *
 * Each IPC channel returns a sensible empty / default value so the app
 * renders without error-toasts and without requiring Electron.
 */

declare const __REPLIT_ANTHROPIC_KEY__: string;
declare const __REPLIT_OPENAI_KEY__: string;
declare const __REPLIT_GOOGLE_KEY__: string;

function safeKey(val: string | undefined): { value: string; encryptionType: "plaintext" } | undefined {
  if (!val) return undefined;
  return { value: val, encryptionType: "plaintext" };
}

function buildDefaultSettings() {
  const anthropicKey = safeKey(
    typeof __REPLIT_ANTHROPIC_KEY__ !== "undefined" ? __REPLIT_ANTHROPIC_KEY__ : undefined,
  );
  const openaiKey = safeKey(
    typeof __REPLIT_OPENAI_KEY__ !== "undefined" ? __REPLIT_OPENAI_KEY__ : undefined,
  );
  const googleKey = safeKey(
    typeof __REPLIT_GOOGLE_KEY__ !== "undefined" ? __REPLIT_GOOGLE_KEY__ : undefined,
  );

  const provider = anthropicKey ? "anthropic" : openaiKey ? "openai" : googleKey ? "google" : "anthropic";
  const modelName =
    provider === "anthropic"
      ? "claude-sonnet-4-5"
      : provider === "openai"
        ? "gpt-4o"
        : "gemini-2.5-flash";

  return {
    selectedModel: { name: modelName, provider },
    providerSettings: {
      ...(anthropicKey ? { anthropic: { apiKey: anthropicKey } } : { anthropic: {} }),
      ...(openaiKey ? { openai: { apiKey: openaiKey } } : { openai: {} }),
      ...(googleKey ? { google: { apiKey: googleKey } } : { google: {} }),
    },
    selectedTemplateId: "react-vite",
    enableAutoUpdate: false,
    releaseChannel: "stable",
  };
}

const DEFAULT_USER_SETTINGS = buildDefaultSettings();

const DEFAULT_NODE_STATUS = {
  nodeVersion: "v24.13.0",
  pnpmVersion: "10.26.1",
  nodeDownloadUrl: "https://nodejs.org/en/download",
};

const DEFAULT_TELEMETRY_CONTEXT = {
  isFirstSession: false,
};

const DEFAULT_BUDGET = null;

const DEFAULT_SYSTEM_DEBUG_INFO = {
  platform: "linux",
  arch: "x64",
  version: "1.0.0",
  nodeVersion: process?.versions?.node ?? "22.0.0",
};

/**
 * Map from IPC channel name to the value (or factory) to return.
 * Factories receive the input argument if needed.
 */
const CHANNEL_DEFAULTS: Record<string, unknown | ((...args: unknown[]) => unknown)> = {
  // Settings
  "get-user-settings": DEFAULT_USER_SETTINGS,
  "set-user-settings": DEFAULT_USER_SETTINGS,

  // Apps
  "list-apps": { apps: [] },
  "create-app": null,
  "get-app": null,
  "delete-app": null,
  "delete-apps": null,
  "copy-app": null,
  "rename-app": null,
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

  // App collections
  "appCollections:list": [],
  "appCollections:create": null,
  "appCollections:update": null,
  "appCollections:delete": null,
  "appCollections:assignApps": null,

  // MCP
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

  // Agent tools
  "agent-tool:get-tools": [],
  "agent-tool:set-consent": null,

  // Language models
  "get-language-model-providers": [],
  "get-language-models": [],
  "get-language-models-by-providers": {},
  "create-custom-language-model-provider": null,
  "edit-custom-language-model-provider": null,
  "delete-custom-language-model-provider": null,
  "create-custom-language-model": null,
  "delete-custom-language-model": null,
  "delete-custom-model": null,
  "local-models:list-ollama": { models: [] },
  "local-models:list-lmstudio": { models: [] },

  // System
  "get-system-platform": "linux",
  "get-initial-load-telemetry-context": DEFAULT_TELEMETRY_CONTEXT,
  "get-system-debug-info": DEFAULT_SYSTEM_DEBUG_INFO,
  "get-app-version": { version: "1.2.0-beta.1" },
  "nodejs-status": DEFAULT_NODE_STATUS,
  "install-pnpm": null,
  "select-node-folder": { path: null, canceled: true, selectedPath: null },
  "get-node-path": null,
  "reload-env-path": null,
  "select-app-folder": { path: null, name: null },
  "get-custom-apps-folder": { path: "/home/runner/workspace/dyad-apps", isPathAvailable: true, isPathDefault: true },
  "select-custom-apps-folder": { path: null, canceled: true },
  "set-custom-apps-folder": null,
  "open-external-url": null,
  "show-item-in-folder": null,
  "open-file-path": null,
  "clear-session-data": null,
  "get-user-budget": DEFAULT_BUDGET,
  "system:get-user-budget": DEFAULT_BUDGET,
  "window:minimize": null,
  "window:maximize": null,
  "window:close": null,
  "window:focus": null,

  // Misc
  "get-env-vars": {},
  "get-app-env-vars": {},
  "set-app-env-vars": null,
  "get-session-debug-bundle": null,
  "add-log": null,
  "clear-logs": null,
  "renderer:error-toast-ready": null,
  "check-problems": { problems: [] },
  "portal:migrate-create": null,

  // GitHub
  "github:list-repos": [],
  "github:get-user": null,
  "github:create-repo": null,
  "github:push": null,

  // Supabase
  "supabase:list-organizations": [],
  "supabase:get-organization": null,

  // Neon
  "neon:list-projects": [],

  // Vercel
  "vercel:list-projects": [],

  // Templates
  "get-templates": [],
  "template:list": [],

  // Prompts
  "prompts:list": [],
  "prompts:create": null,
  "prompts:update": null,
  "prompts:delete": null,

  // Themes / custom themes
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

  // Media
  "list-all-media": [],

  // Free agent quota
  "free-agent-quota:get-status": {
    messagesUsed: 0,
    messagesLimit: 5,
    isQuotaExceeded: false,
    windowStartTime: null,
    resetTime: null,
    hoursUntilReset: null,
  },

  // Versions
  "versions:list": [],
  "versions:checkout": null,

  // Chat
  "get-chats": [],
  "search-chats": [],

  // Checkout (Dyad Pro)
  "checkout:get-version": null,
};

function mockInvoke(channel: string, ..._args: unknown[]): Promise<unknown> {
  if (Object.prototype.hasOwnProperty.call(CHANNEL_DEFAULTS, channel)) {
    const val = CHANNEL_DEFAULTS[channel];
    const result = typeof val === "function" ? (val as Function)(..._args) : val;
    return Promise.resolve(result);
  }
  // Unknown channel — resolve to null so callers don't crash
  console.debug(`[browser-ipc-mock] unhandled channel: ${channel}`);
  return Promise.resolve(null);
}

function mockOn(
  _channel: string,
  _listener: (...args: unknown[]) => void,
): () => void {
  // Return an unsubscribe no-op
  return () => {};
}

function mockOff(_channel: string, _listener: (...args: unknown[]) => void): void {
  // no-op
}

function mockSend(_channel: string, ..._args: unknown[]): void {
  // no-op
}

/**
 * Install the mock onto window.electron so the IPC client finds it.
 * Only installs when Electron's real ipcRenderer is absent.
 */
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
    // Real Electron renderer is present — leave it alone
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
