/**
 * Description: Runtime shim for `@tauri-apps/api/core`. esbuild's
 *   `alias` redirects every `import { invoke } from
 *   '@tauri-apps/api/core'` in this plugin to this file, routing
 *   Tauri calls through the host-provided global.
 *
 *   The type-only import below keeps the `invoke` signature identical
 *   to the upstream package without pulling any runtime code into our
 *   bundle.
 *
 * Inputs: host sets `globalThis.__BINDERUS_PLUGIN_API__.invoke`.
 * Outputs: `invoke` with the full upstream signature.
 */

// Type-only — erased at runtime; no bundle impact.
import type { invoke as upstreamInvoke } from '@tauri-apps/api/core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = (globalThis as any).__BINDERUS_PLUGIN_API__;
if (!api || typeof api.invoke !== 'function') {
  throw new Error(
    '[ai-chat] Host did not provide __BINDERUS_PLUGIN_API__.invoke. ' +
      'This plugin can only run inside Binderus >= 0.7.2.',
  );
}

export const invoke: typeof upstreamInvoke = api.invoke;
