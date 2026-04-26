# Example User Plugins

These are reference implementations of third-party plugins for Binderus. They are
**not compiled into the app bundle**. Each subfolder is a standalone buildable
package that produces a `.zip` the user drops into
`<vault>/.binderus/plugins/<plugin-id>/` and the host loads at startup via
`src/app/plugins/plugin-loader.ts`.

## Why live in this repo?

Keeping the reference plugins here rather than in a separate repo makes it
cheaper to:

- Keep the plugin host contract and the example plugins in lock-step (changes to
  `src/app/plugins/plugin-types.ts` should be mirrored in each example's
  `src/host-types.ts`).
- Show new plugin authors a full, idiomatic implementation without hunting for
  an external repo.
- Run end-to-end CI against the loader by building the example and loading the
  resulting zip into a headless Tauri app.

None of these examples are imported from `src/` — look for any `import` of
`examples/` to confirm. They ship as independent npm packages with their own
`node_modules/`.

## Current examples

| Plugin | What it demonstrates |
|---|---|
| `ai-chat/` | Slide-out panel, scoped settings, Quick Switcher commands, streaming HTTP against any OpenAI-compatible LLM (Ollama, LM Studio, OpenAI, DeepInfra, Groq, Together, OpenRouter), selection/file/directory context modes, the full runtime-bridge (`react` / `react-dom` / `@tauri-apps/api/core` aliased to shims). |

## Adding a new example

1. `cp -r examples/plugins/ai-chat examples/plugins/<your-id>`
2. Rewrite `manifest.json`, `package.json`, and `src/index.ts`.
3. Build: `pnpm install && pnpm build`. Package: `pnpm package`.
4. Install into a local vault: `unzip dist/<your-id>.zip -d <vault>/.binderus/plugins/<your-id>/`.
5. Launch Binderus and check the dev console for `[plugin-loader] Activated user plugin '<your-id>'`.
