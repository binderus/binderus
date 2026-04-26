/**
 * Description: Runtime shim for `react`. esbuild's `alias` option rewrites
 *   every `import ... from 'react'` in this plugin to point at this file,
 *   so the plugin shares the host's React instance (required for hooks
 *   to work across module boundaries).
 *
 *   Types come from `@types/react` at compile time via `import type` —
 *   those imports are erased in the emitted JS, so there is no runtime
 *   cost and no circular resolution through the alias.
 *
 * Inputs: host sets `globalThis.__BINDERUS_PLUGIN_API__.React` before
 *   this module's first evaluation.
 * Outputs: re-exports the host's React default plus the hooks and
 *   utilities used by this plugin.
 */

// Type-only import — erased at runtime, ignored by esbuild's alias
// because esbuild only rewrites value imports.
import type * as ReactNS from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = (globalThis as any).__BINDERUS_PLUGIN_API__;
if (!api || !api.React) {
  throw new Error(
    '[ai-chat] Host did not provide __BINDERUS_PLUGIN_API__.React. ' +
      'This plugin can only run inside Binderus >= 0.7.2.',
  );
}

const React = api.React as typeof ReactNS;

export default React;

export const createElement: typeof ReactNS.createElement = React.createElement;
export const Fragment: typeof ReactNS.Fragment = React.Fragment;
export const useState: typeof ReactNS.useState = React.useState;
export const useEffect: typeof ReactNS.useEffect = React.useEffect;
export const useMemo: typeof ReactNS.useMemo = React.useMemo;
export const useRef: typeof ReactNS.useRef = React.useRef;
export const useCallback: typeof ReactNS.useCallback = React.useCallback;
