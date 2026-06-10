---
name: Browser IPC mock patterns
description: How the browser-ipc-mock.ts works and what must be kept in sync for Dyad to work in browser/Replit mode
---

# Browser IPC Mock Patterns

**Why:** Dyad is an Electron app. In Replit preview mode, there is no Electron IPC. `src/browser-ipc-mock.ts` intercepts all `window.electron.ipcRenderer` calls and provides browser-safe implementations.

## Critical patterns

### Event emitter (streaming chat)
`mockOn`/`mockOff` MUST maintain a real `_eventListeners` Map so that `chat:response:chunk`, `chat:response:end`, `chat:response:error`, `chat:stream:start`, `chat:stream:end` events reach the `createStreamClient` listeners. The old no-op mock broke all chat streaming.

### create-app must return `{ app, chatId }`
The shape is `CreateAppResultSchema = z.object({ app: AppBaseSchema.extend({ resolvedPath }), chatId: z.number() })`. Returning `null` causes `Cannot read properties of null (reading 'chatId')`.

### create-chat returns a number (chatId)
`CreateChatResultSchema = z.number()` — just the chat ID integer.

### get-language-models-by-providers must return populated data
Must return `Record<string, LanguageModel[]>` with models for each provider that has an API key. Returning `{}` causes "No cloud models available" in ModelPicker.

### Settings persistence
Settings are stored in `localStorage` under key `"dyad-browser-ipc-settings"`. The `set-user-settings` handler must deep-merge `providerSettings` (not shallow-merge) and call `saveSettings()` to persist. `loadSettings()` runs on mock init.

### Real AI calls in browser
- Google AI (Gemini): `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}` — supports CORS from browser
- OpenAI: `https://api.openai.com/v1/chat/completions` with `Authorization: Bearer {key}` — needs CORS
- Anthropic: `https://api.anthropic.com/v1/messages` with `anthropic-dangerous-direct-browser-access: true` header
- OpenRouter: `https://openrouter.ai/api/v1/chat/completions`

### Route: providerSettingsRoute must be top-level
`providerSettingsRoute` must have `getParentRoute: () => rootRoute` and path `"/settings/providers/$provider"`. Adding it as a child of `settingsRoute` breaks navigation because `SettingsPage` has no `<Outlet />`.

### @shikijs symlinks
Manual absolute symlinks needed in `node_modules/@shikijs/{themes,langs,core,types}` → `node_modules/.pnpm/@shikijs+*@3.23.0/...`

**How to apply:** Any time browser-ipc-mock.ts is modified, verify these five things: (1) event emitter is real, (2) create-app returns proper shape, (3) models-by-providers returns populated data for configured providers, (4) settings are persisted to localStorage, (5) providerSettingsRoute is a top-level route.
