# AI Chat — Binderus User Plugin (Standalone)

A **standalone, zip-shippable** Binderus user plugin that chats with any
OpenAI-compatible LLM — local Ollama / LM Studio, or cloud providers like OpenAI,
DeepInfra, Groq, Together, OpenRouter — using the current editor, a selection, a
list of files, or a whole folder as context.

A standalone reference user plugin — no compile-time coupling to Binderus, a tiny
runtime bridge, and a single `.zip` the user drops into their vault.

## Directory layout

```
examples/plugins/ai-chat/
├── manifest.json         # id, name, version, minAppVersion
├── package.json          # build-time deps only (esbuild, tsc, React types)
├── tsconfig.json
├── esbuild.mjs           # bundler — emits dist/main.js
├── scripts/pack-zip.mjs  # zips dist/ into dist/ai-chat.zip
└── src/
    ├── index.ts          # default export: pluginFactory(api) → AppPlugin
    ├── host-types.ts     # mirror of the host plugin contract
    ├── panel.tsx         # chat UI
    ├── settings-form.tsx # settings UI
    ├── llm-client.ts     # fetch()-based OpenAI-compatible client
    ├── context-gatherer.ts
    ├── types.ts
    ├── locales/en-US.json
    └── shims/            # react / react-dom / @tauri-apps/api/core shims
        ├── react-shim.ts
        ├── react-dom-shim.ts
        └── tauri-core-shim.ts
```

## Build

```bash
cd examples/plugins/ai-chat
pnpm install    # or npm install
pnpm typecheck  # optional
pnpm build      # → dist/main.js + dist/manifest.json + dist/locales/
pnpm package    # → dist/ai-chat.zip
```

## Install into a vault

1. Build and package (`pnpm package`).
2. Create the target folder if it doesn't exist:
   `mkdir -p <vault>/.binderus/plugins/ai-chat`
3. Unzip the output into that folder:
   `unzip dist/ai-chat.zip -d <vault>/.binderus/plugins/ai-chat/`
4. Launch Binderus — the plugin loader will discover it at startup and activate it.

The final on-disk layout should be:

```
<vault>/.binderus/plugins/ai-chat/
├── manifest.json
├── main.js
└── locales/
    └── en-US.json
```

## Binderus host APIs used

**Runtime bridge** — `globalThis.__BINDERUS_PLUGIN_API__` provides `{ React, createElement, invoke }`. Shims in `src/shims/` + esbuild aliases keep these out of the bundle.

**Plugin context** (`ctx` in `activate(ctx)`):

| API                                        | Used for                             |
| ------------------------------------------ | ------------------------------------ |
| `ctx.panel.register(desc)` → `PanelHandle` | Slide-out chat panel                 |
| `ctx.commands.register(desc)`              | "Open AI Chat" in Quick Switcher     |
| `ctx.shortcuts.register('Cmd+L', cb)`      | Global shortcut — toggles the panel; runs at capture phase so it shadows the built-in app shortcut bound to the same combo |
| `ctx.settings.{get,set,onChange}`          | Persist host/model/prompt/etc.       |
| `ctx.editor.getActiveDocument()`           | "Editor" context mode                |
| `ctx.t` / `ctx.onLocaleChange`             | i18n                                 |
| `ctx.log`                                  | DevTools diagnostics                 |

**Tauri commands** (via `invoke`) — storage-backend agnostic:

- `read_file({ filePath })` — fallback when `getActiveDocument().content` is empty (lazy hydration), and for "Files" / "Directory" modes.
- `read_directory({ dir })` — recursive `.md`/`.txt`/`.mdx` discovery for "Directory" mode.

**Window event** — `editor-selection-change` (`{ text, from?, to? }`) powers "Selection" mode.

**Install layout** — host unpacks to `<vault>/.binderus/plugins/ai-chat/` with `manifest.json` + `main.js` + `locales/` at the root.

## Plugin factory contract

```ts
// src/index.ts
export default function pluginFactory(api: PluginApi): AppPlugin {
  return {
    id: 'ai-chat',
    version: '0.2.0',
    activate(ctx) {
      /* ... */
      return () => {
        /* cleanup */
      };
    },
  };
}
```

The host calls `mod.default(api)` once at load time, registers the returned
AppPlugin via its existing plugin-manager, and calls `deactivate()` if the user
disables the plugin from the Manage Plugins modal.

## Updating

Bump `version` in `manifest.json` + `package.json` + `src/index.ts` together, then
rebuild. The host picks up the new `main.js` on the next app restart.
