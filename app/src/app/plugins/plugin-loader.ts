/**
 * Description: Runtime loader for USER plugins. Scans
 *   `<vault>/.binderus/plugins/*` for unpacked plugin folders, reads each
 *   folder's `manifest.json` + `main.js`, and activates the plugin via
 *   the existing plugin-manager.
 *
 *   Plugins are NOT bundled into the app — they ship as standalone .zip
 *   files the user unpacks (or installs via the Manage Plugins "Install
 *   from zip" button) into the vault's plugin folder. The host injects
 *   runtime dependencies (React, createElement, Tauri invoke) via a
 *   global shim so plugins don't need to bundle their own copies.
 *
 *   Plugin module contract:
 *     export default function pluginFactory(api: PluginApi): AppPlugin
 *
 *   Where `api` carries the shared runtime dependencies (React, invoke,
 *   createElement). The factory returns a normal AppPlugin module which
 *   the host registers and activates.
 *
 * Inputs: called once at app startup from registerBuiltInPlugins(), and
 *   ad-hoc from the install-from-zip flow via `hotLoadUserPluginById`.
 * Outputs: side effect — each discovered plugin is activated (same as
 *   built-ins). Failures are logged and do not abort loading other
 *   plugins.
 */

import { invoke } from '@tauri-apps/api/core';
import * as React from 'react';
import { createElement } from 'react';

import { useAppStore } from '../hooks/use-app-store';
import { activatePlugin, deactivatePlugin } from './plugin-manager';
import type { AppPlugin } from './plugin-types';

// Shape of a plugin's manifest.json — mirrors the minimal Obsidian manifest
// format so author docs stay familiar.
interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion?: string;
  description?: string;
  author?: string;
}

// What the host hands to each plugin's factory at activation time.
// Keep this list SMALL and explicit — every exposed API is a support
// surface we'll need to maintain backward compatibility on.
export interface PluginApi {
  React: typeof React;
  createElement: typeof createElement;
  invoke: typeof invoke;
}

// Name of the global shim plugin bundles reach through. Kept short —
// authors will see this if their devtools break during development, so
// the name should communicate "don't touch".
const PLUGIN_API_GLOBAL = '__BINDERUS_PLUGIN_API__';

/**
 * Install the shared API on globalThis. Plugin bundles are built with
 * `react` and `@tauri-apps/api/core` aliased to tiny shims that forward
 * to this global, so the plugin and the host share a single React
 * instance (critical — otherwise hooks break across instances).
 *
 * Idempotent: safe to call multiple times. Last writer wins.
 */
function installPluginApiGlobal(api: PluginApi): void {
  (globalThis as unknown as Record<string, PluginApi>)[PLUGIN_API_GLOBAL] = api;
}

// Shape of a plugin module loaded via dynamic import().
type PluginModule = {
  default?: (api: PluginApi) => AppPlugin;
};


/**
 * Read and parse a manifest.json. Returns null on any I/O or parse
 * error — the caller logs and skips the plugin.
 */
async function readManifest(
  vaultPath: string,
  pluginId: string,
): Promise<PluginManifest | null> {
  // Plugin assets live on the real filesystem — read them via the
  // plugin-scoped Tauri command, which bypasses the StorageProvider so
  // encrypted-DB mode still works.
  try {
    const text = await invoke<string>('read_plugin_file', {
      vaultPath,
      pluginId,
      fileName: 'manifest.json',
    });
    const parsed = JSON.parse(text) as Partial<PluginManifest>;
    if (typeof parsed.id !== 'string' || !parsed.id) return null;
    if (typeof parsed.name !== 'string' || !parsed.name) return null;
    if (typeof parsed.version !== 'string' || !parsed.version) return null;
    return parsed as PluginManifest;
  } catch (err) {
    console.warn('[plugin-loader] Failed to read manifest:', pluginId, err);
    return null;
  }
}

/**
 * Load a plugin's main.js as a Blob URL and dynamic-import it. Returns
 * the default export (the factory) if present, else null.
 *
 * We use a Blob URL rather than `data:` URI because Chromium blocks
 * `data:` module imports for security reasons, and Blob URLs work
 * identically in a Tauri webview.
 */
async function importPluginModule(
  vaultPath: string,
  pluginId: string,
): Promise<PluginModule | null> {
  let blobUrl: string | null = null;
  try {
    const source = await invoke<string>('read_plugin_file', {
      vaultPath,
      pluginId,
      fileName: 'main.js',
    });
    const blob = new Blob([source], { type: 'text/javascript' });
    blobUrl = URL.createObjectURL(blob);
    // Dynamic import of the blob URL. The plugin is expected to have
    // been built as an ESM bundle with a default export.
    const mod = (await import(/* @vite-ignore */ blobUrl)) as PluginModule;
    return mod;
  } catch (err) {
    console.error('[plugin-loader] Failed to import plugin module:', pluginId, err);
    return null;
  } finally {
    // Safe to revoke — the module is already executed and cached by the
    // engine; keeping the URL alive buys us nothing.
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Install the plugin-api global exactly once per process. Both the
 * startup scan and the hot-load path flow through here so plugin
 * bundles always see the shim before their first evaluation.
 */
let apiInstalled = false;
function ensureApiInstalled(): PluginApi {
  const api: PluginApi = { React, createElement, invoke };
  if (!apiInstalled) {
    installPluginApiGlobal(api);
    apiInstalled = true;
  }
  return api;
}

/**
 * Activate a single plugin folder. Returns the activated plugin id on
 * success, or an Error with a user-friendly message. Used by both the
 * bulk scan at startup and the post-install hot-load.
 */
async function loadPluginFromFolder(
  vaultPath: string,
  pluginId: string,
  expectedId: string | null,
  api: PluginApi,
): Promise<{ id: string } | Error> {
  const manifest = await readManifest(vaultPath, pluginId);
  if (!manifest) {
    return new Error(`No valid manifest.json for plugin '${pluginId}'`);
  }
  if (expectedId !== null && manifest.id !== expectedId) {
    return new Error(
      `Manifest id '${manifest.id}' does not match expected '${expectedId}'`,
    );
  }

  const mod = await importPluginModule(vaultPath, pluginId);
  if (!mod || typeof mod.default !== 'function') {
    return new Error(`main.js has no default export factory (${manifest.id})`);
  }

  let plugin: AppPlugin;
  try {
    plugin = mod.default(api);
  } catch (err) {
    return new Error(`Factory threw for ${manifest.id}: ${String(err)}`);
  }

  if (plugin.id !== manifest.id) {
    console.warn(
      `[plugin-loader] Plugin id mismatch for ${manifest.id}: module returned '${plugin.id}'. Using manifest id.`,
    );
    plugin = { ...plugin, id: manifest.id };
  }

  try {
    activatePlugin(plugin);
  } catch (err) {
    return new Error(`activatePlugin failed for ${plugin.id}: ${String(err)}`);
  }

  console.info(`[plugin-loader] Activated user plugin '${plugin.id}' v${plugin.version}.`);
  return { id: plugin.id };
}

/**
 * Load every plugin folder found under `<vault>/.binderus/plugins/`.
 * Each folder must contain `manifest.json` + `main.js` at its root.
 *
 * Errors in one plugin do not abort the others. All failures are
 * logged; successful activations produce a console.info entry.
 */
let userPluginsLoaded = false;

async function scanVault(vaultPath: string): Promise<void> {
  if (userPluginsLoaded) return;
  userPluginsLoaded = true;

  // list_plugin_ids reads the real filesystem and returns only folder
  // names matching the plugin-id charset, bypassing the active
  // StorageProvider (which in encrypted-DB mode has no view of the
  // on-disk plugins dir).
  let ids: string[];
  try {
    ids = await invoke<string[]>('list_plugin_ids', { vaultPath });
  } catch (err) {
    console.info(`[plugin-loader] No user plugins found (${String(err)})`);
    return;
  }

  if (ids.length === 0) {
    console.info('[plugin-loader] No user plugins installed.');
    return;
  }

  const api = ensureApiInstalled();
  console.info(`[plugin-loader] Found ${ids.length} plugin folder(s) to try.`);

  for (const id of ids) {
    const result = await loadPluginFromFolder(vaultPath, id, null, api);
    if (result instanceof Error) {
      console.warn(`[plugin-loader] ${result.message}`);
    }
  }
}

export async function loadUserPluginsFromVault(): Promise<void> {
  const vaultPath = useAppStore.getState().vaultPath;
  if (vaultPath) {
    await scanVault(vaultPath);
    return;
  }

  // Cold start: registerBuiltInPlugins can fire before initApp() hydrates
  // vaultPath (esp. in encrypted-DB mode where unlock happens after
  // AppContainer mounts). Subscribe until a non-empty value arrives.
  const unsub = useAppStore.subscribe((state) => {
    if (state.vaultPath) {
      unsub();
      void scanVault(state.vaultPath);
    }
  });
}

/**
 * Hot-load a single plugin by id. Used by the "Install from zip" flow
 * after the Rust installer has unpacked the files: we already know the
 * manifest id, so we can activate the plugin in-place without a
 * restart.
 *
 * If a plugin with the same id is already active, it is deactivated
 * first so the new build replaces the old one cleanly (disposables
 * fire, event handlers unregister, etc.).
 *
 * Returns { ok: true } on success, or { ok: false, error } with a
 * string the caller can surface in the UI.
 */
export async function hotLoadUserPluginById(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const vaultPath = useAppStore.getState().vaultPath;
  if (!vaultPath) {
    return { ok: false, error: 'No vault open — cannot load plugin.' };
  }

  const api = ensureApiInstalled();

  // If an older build of this plugin is currently active, tear it down
  // before replacing it. deactivatePlugin is a no-op when the id isn't
  // active, so we don't need to check first.
  try {
    deactivatePlugin(id);
  } catch (err) {
    console.warn(`[plugin-loader] deactivate of existing '${id}' threw:`, err);
  }

  const result = await loadPluginFromFolder(vaultPath, id, id, api);
  if (result instanceof Error) {
    return { ok: false, error: result.message };
  }
  return { ok: true };
}
