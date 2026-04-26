/**
 * Description: Plugin-scoped settings store, persisted to the vault settings
 *   JSON under the `plugins.<id>` namespace. Backed by the existing
 *   `read_vault_settings` / `write_vault_settings` Tauri commands — no new
 *   Rust commands required.
 *
 *   The store is loaded lazily on first `get()` or `set()` call per plugin,
 *   cached in memory, and flushed to disk on every `set()` (debounced).
 *   Listeners are notified synchronously so the panel UI can re-render
 *   immediately — disk I/O happens in the background.
 * Inputs: invoke('read_vault_settings' | 'write_vault_settings')
 * Outputs: createSettingsApi(pluginId): PluginSettingsApi factory used by
 *          plugin-manager when building the PluginContext.
 */

import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../hooks/use-app-store';
import { isWeb } from '../utils/base-utils';
import type { PluginSettingsApi } from './plugin-types';

type AnyRecord = Record<string, unknown>;
type Listener = (settings: AnyRecord) => void;

interface PluginBucket {
  loaded: boolean;
  loading?: Promise<void>;
  data: AnyRecord;
  listeners: Set<Listener>;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

const buckets = new Map<string, PluginBucket>();

function getBucket(pluginId: string): PluginBucket {
  let b = buckets.get(pluginId);
  if (!b) {
    b = { loaded: false, data: {}, listeners: new Set(), flushTimer: null };
    buckets.set(pluginId, b);
  }
  return b;
}

function currentVaultPath(): string | null {
  return useAppStore.getState().vaultPath ?? null;
}

async function readAllPluginSettings(vaultPath: string): Promise<AnyRecord> {
  if (isWeb) {
    const raw = localStorage.getItem(`binderus.vault-settings.${vaultPath}`) ?? '{}';
    try { return JSON.parse(raw); } catch { return {}; }
  }
  try {
    const raw = (await invoke('read_vault_settings', { vaultPath })) as string;
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('[plugin-settings] read_vault_settings failed', err);
    return {};
  }
}

async function writeAllPluginSettings(vaultPath: string, full: AnyRecord): Promise<void> {
  const json = JSON.stringify(full, null, 2);
  if (isWeb) {
    localStorage.setItem(`binderus.vault-settings.${vaultPath}`, json);
    return;
  }
  try {
    await invoke('write_vault_settings', { vaultPath, json });
  } catch (err) {
    console.error('[plugin-settings] write_vault_settings failed', err);
  }
}

async function loadBucket(pluginId: string): Promise<void> {
  const b = getBucket(pluginId);
  if (b.loaded) return;
  if (b.loading) return b.loading;

  const vp = currentVaultPath();
  if (!vp) {
    // No vault yet — treat as empty settings until a vault is mounted.
    b.loaded = true;
    return;
  }

  b.loading = (async () => {
    const all = await readAllPluginSettings(vp);
    const plugins = (all.plugins as AnyRecord | undefined) ?? {};
    b.data = (plugins[pluginId] as AnyRecord | undefined) ?? {};
    b.loaded = true;
    b.loading = undefined;
    // Fire listeners once after initial load so panels pick up persisted values.
    b.listeners.forEach((l) => {
      try { l(b!.data); } catch (e) { console.error('[plugin-settings] listener threw', e); }
    });
  })();
  return b.loading;
}

function scheduleFlush(pluginId: string): void {
  const b = getBucket(pluginId);
  if (b.flushTimer) clearTimeout(b.flushTimer);
  b.flushTimer = setTimeout(async () => {
    b.flushTimer = null;
    const vp = currentVaultPath();
    if (!vp) return;
    const all = await readAllPluginSettings(vp);
    const plugins = ((all.plugins as AnyRecord | undefined) ?? {}) as AnyRecord;
    plugins[pluginId] = b.data;
    all.plugins = plugins;
    await writeAllPluginSettings(vp, all);
  }, 250);
}

/**
 * Build a PluginSettingsApi bound to one plugin id. Called by plugin-manager
 * when constructing a PluginContext. The returned API is safe to call before
 * the initial load resolves — get() returns {} until the first async read
 * completes, at which point onChange listeners fire with the loaded values.
 */
export function createSettingsApi<T extends AnyRecord = AnyRecord>(pluginId: string): PluginSettingsApi<T> {
  // Kick off load but don't await — get() returns {} meanwhile.
  void loadBucket(pluginId);

  return {
    get(): T {
      return (getBucket(pluginId).data as T);
    },
    set(partial: Partial<T>): void {
      const b = getBucket(pluginId);
      b.data = { ...b.data, ...partial };
      // Notify synchronously so panels render without waiting on disk.
      b.listeners.forEach((l) => {
        try { l(b.data); } catch (e) { console.error('[plugin-settings] listener threw', e); }
      });
      scheduleFlush(pluginId);
    },
    replace(next: T): void {
      const b = getBucket(pluginId);
      b.data = { ...next };
      b.listeners.forEach((l) => {
        try { l(b.data); } catch (e) { console.error('[plugin-settings] listener threw', e); }
      });
      scheduleFlush(pluginId);
    },
    onChange(cb: (settings: T) => void): () => void {
      const b = getBucket(pluginId);
      const wrapped = (s: AnyRecord) => cb(s as T);
      b.listeners.add(wrapped);
      return () => b.listeners.delete(wrapped);
    },
  };
}

/** Used by plugin-manager on deactivate to clear listeners + pending flush. */
export function disposePluginSettings(pluginId: string): void {
  const b = buckets.get(pluginId);
  if (!b) return;
  if (b.flushTimer) clearTimeout(b.flushTimer);
  b.listeners.clear();
  // Keep b.data so re-activating picks up the same in-memory cache.
}
