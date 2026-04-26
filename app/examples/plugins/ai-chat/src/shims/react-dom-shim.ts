/**
 * Description: Runtime shim for `react-dom`. We don't actually use any
 *   ReactDOM APIs directly (the host mounts our panel React nodes), but
 *   some transitive imports may touch the module. This shim keeps the
 *   bundle happy without bundling another copy of react-dom.
 *
 * Inputs: host MAY set `globalThis.__BINDERUS_PLUGIN_API__.ReactDOM`;
 *   if it doesn't, we export an empty object.
 * Outputs: the host's ReactDOM (or `{}` fallback) as the default export.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = (globalThis as any).__BINDERUS_PLUGIN_API__;
const ReactDOM = (api && api.ReactDOM) || {};

export default ReactDOM;
