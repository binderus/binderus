/**
 * Description: Fetch the remote plugin registry, download plugin zips
 *   from `binderus.com/api/plugin`, verify their sha256, and hand them
 *   off to the existing `install_plugin_from_zip` Tauri command.
 *
 *   Registry schema v2: each plugin entry is flat (one current version
 *   per plugin). Older versions remain downloadable via release tag but
 *   are not listed in the registry.
 *
 * Requirements: @tauri-apps/api/core, @tauri-apps/api/path,
 *   @tauri-apps/plugin-fs, @tauri-apps/plugin-http, browser SubtleCrypto.
 * Inputs: network access to binderus.com.
 * Outputs: typed registry data + an `installFromRegistry` action.
 */

import { invoke } from '@tauri-apps/api/core';
import { tempDir, join } from '@tauri-apps/api/path';
import { writeFile, remove } from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

import { useAppStore } from '../hooks/use-app-store';

const REGISTRY_URL = 'https://www.binderus.com/api/plugin-registry';
const DOWNLOAD_URL_BASE = 'https://www.binderus.com/api/plugin';

export interface RegistryPlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  tags?: string[];
  version: string;
  minAppVersion: string;
  sha256: string;
  sizeBytes: number;
  downloadUrl: string;
  publishedAt: string;
}

export interface PluginRegistry {
  schemaVersion: number;
  plugins: RegistryPlugin[];
}

let cache: { at: number; data: PluginRegistry } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function fetchRegistry(force = false): Promise<PluginRegistry> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const res = await tauriFetch(REGISTRY_URL);
  if (res.status === 404) {
    const empty: PluginRegistry = { schemaVersion: 2, plugins: [] };
    cache = { at: Date.now(), data: empty };
    return empty;
  }
  if (!res.ok) throw new Error(`Registry fetch failed: ${res.status}`);
  const data = (await res.json()) as PluginRegistry;
  cache = { at: Date.now(), data };
  return data;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface InstallResult {
  id: string;
  name: string;
  version: string;
  installedPath: string;
}

/**
 * Download → verify sha256 → write to temp → invoke existing Rust
 * installer → clean up temp. Callers should follow up with
 * `hotLoadUserPluginById(id)` to activate without an app restart.
 */
export async function installFromRegistry(
  plugin: RegistryPlugin,
  vaultPath: string,
): Promise<InstallResult> {
  const uid = useAppStore.getState().clientUuid ?? '';
  const uidParam = uid ? `&uid=${encodeURIComponent(uid)}` : '';
  const url = `${DOWNLOAD_URL_BASE}?id=${encodeURIComponent(plugin.id)}&version=${encodeURIComponent(plugin.version)}${uidParam}`;
  const res = await tauriFetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const bytes = await res.arrayBuffer();

  if (plugin.sizeBytes && bytes.byteLength !== plugin.sizeBytes) {
    throw new Error(
      `Size mismatch: expected ${plugin.sizeBytes}, got ${bytes.byteLength}`,
    );
  }
  const actual = await sha256Hex(bytes);
  if (actual.toLowerCase() !== plugin.sha256.toLowerCase()) {
    throw new Error(
      `Checksum mismatch for ${plugin.id}@${plugin.version}. Refusing to install.`,
    );
  }

  const tmp = await tempDir();
  const tmpZip = await join(tmp, `binderus-plugin-${plugin.id}-${plugin.version}.zip`);
  await writeFile(tmpZip, new Uint8Array(bytes));

  try {
    return await invoke<InstallResult>('install_plugin_from_zip', {
      zipPath: tmpZip,
      vaultPath,
    });
  } finally {
    try {
      await remove(tmpZip);
    } catch {}
  }
}
