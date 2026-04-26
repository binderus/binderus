import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import {
  BaseDirectory,
  mkdir,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { documentDir as _documentDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_SETTING, EXAMPLE_NOTE, VERSION } from './constants';
import { FileType } from '../types';
import { isWeb, sanitizeInternalLink, t } from './base-utils';
import { open as tauriOpen } from '@tauri-apps/plugin-shell';

/** Returns the Documents directory path without a trailing slash. */
export const getDocumentDir = async () => {
  const dir = await _documentDir();
  return dir.replace(/\/+$/, '');
};

export type ReadDirResponse = {
  files?: FileType[];
};

/** Current vault path (absolute). Set during init from storage info. */
let _vaultPath = '';
export const getVaultPath = () => _vaultPath;
export const setVaultPath = (p: string) => {
  // On vault switch, nuke both caches — stale listings from the previous vault
  // are hazardous when paths collide (common vault names like "Notes").
  if (_vaultPath && _vaultPath !== p) {
    clearReadCache();
    clearDirCache();
  }
  _vaultPath = p;
  // Keep the Zustand store in sync so components and plugin-loader
  // see the value via useAppStore. The store import would create a
  // cycle with use-app-store → tauri-utils, so defer the import.
  import('../hooks/use-app-store').then(({ useAppStore }) => {
    if (useAppStore.getState().vaultPath !== p) {
      useAppStore.getState().setVaultPath(p);
    }
  });
};

export const getPath = async (subPath = '', fullPath = true) => {
  if (fullPath === false) {
    // Return relative path from Documents
    const documentPath = await getDocumentDir();
    return _vaultPath ? `${_vaultPath.replace(documentPath + '/', '')}/${subPath}` : `Binderus/${subPath}`;
  }
  return `${_vaultPath || (await getDocumentDir()) + '/Binderus'}/${subPath}`;
};

const handleError = (e: any) => {
  console.error(e);
  let msg = e;
  if (`${e}`.indexOf('Read-only file system') >= 0) {
    msg = 'ERROR: Folder is read-only. Please grant the write permission.';
  }
  return msg;
};

// create a folder — parentPath must be an absolute path (or empty for root data dir)
export const createFolder = async (parentPath?: string, dirName?: string) => {
  try {
    const base = parentPath || (await getPath('', true));
    await invoke('create_dir_recursive', { dirPath: `${base}/${dirName}` });
    // New dir under `base` → invalidate `base`'s listing
    invalidateDirCache(base);
  } catch (e) {
    handleError(e);
  }
};

export const newFile = async (filePath: string, newFileName: string) => {
  try {
    const base = filePath || (await getPath('', true));
    await invoke('write_file', { filePath: `${base}/${newFileName}.md`, text: '' });
    // New file under `base` → invalidate `base`'s listing
    invalidateDirCache(base);
  } catch (e) {
    handleError(e);
  }
};

// ---------------------------------------------------------------------------
// File I/O with LRU cache
// ---------------------------------------------------------------------------
//
// 50-entry LRU keyed by absolute file path. Use Map's insertion-order
// iteration to find the oldest entry in O(1). Writes invalidate their own
// path so readers get fresh content immediately after save/autosave.
//
// Rationale: opening a previously-visited tab re-invokes the Rust `read_file`
// IPC even when the content is identical to what we just wrote. In big vaults
// the round-trip dominates tab-switch latency; a short-lived cache collapses
// it to a single Map.get() for hot tabs.

const READ_CACHE_MAX = 50;
const readCache = new Map<string, string>();

/** Invalidate a single cache entry — call after any out-of-band mutation. */
export const invalidateReadCache = (filePath: string) => {
  readCache.delete(filePath);
};

/** Clear the entire read cache — call after bulk FS changes (vault open/close, etc.). */
export const clearReadCache = () => {
  readCache.clear();
};

/**
 * Cached `read_file` wrapper. Returns content as string. Skips the cache in
 * `isWeb` mode because the mock layer is already in-memory; callers in web
 * mode should use mockReadFile directly.
 */
export const readFileCached = async (filePath: string): Promise<string> => {
  if (isWeb) return '';
  const cached = readCache.get(filePath);
  if (cached !== undefined) {
    // Touch: move to newest by re-inserting.
    readCache.delete(filePath);
    readCache.set(filePath, cached);
    return cached;
  }
  const content = `${(await invoke('read_file', { filePath })) ?? ''}`;
  // Evict the oldest (first-inserted) entry when over capacity.
  if (readCache.size >= READ_CACHE_MAX) {
    const oldest = readCache.keys().next().value;
    if (oldest !== undefined) readCache.delete(oldest);
  }
  readCache.set(filePath, content);
  return content;
};

/**
 * `write_file` wrapper that keeps the LRU consistent — pre-populates the
 * cache with the just-written content, so the next read is a hit.
 */
export const writeFileCached = async (filePath: string, text: string): Promise<void> => {
  await invoke('write_file', { filePath, text });
  if (!isWeb) {
    if (readCache.size >= READ_CACHE_MAX && !readCache.has(filePath)) {
      const oldest = readCache.keys().next().value;
      if (oldest !== undefined) readCache.delete(oldest);
    }
    // Re-insert to mark as most-recent.
    readCache.delete(filePath);
    readCache.set(filePath, text);
  }
};

// ---------------------------------------------------------------------------
// Directory-listing cache
// ---------------------------------------------------------------------------
//
// Short-lived LRU for `read_directory` IPC responses. Sidebar re-renders on
// tab switch / mode switch frequently visit the same folders (back/forward
// in history, toggling between favorites/recent/all). A 20-entry LRU with a
// 3-second TTL eliminates the redundant IPC round-trip for hot folders while
// keeping staleness tight in case of out-of-band edits. All mutation helpers
// (create/delete/move/rename) invalidate the affected parent dir explicitly.
//
// TTL guards against edge cases (external editor, git pull) without relying
// solely on invalidation correctness.

const DIR_CACHE_MAX = 20;
const DIR_CACHE_TTL_MS = 3000;
interface DirCacheEntry { res: ReadDirResponse; at: number; }
const dirCache = new Map<string, DirCacheEntry>();

/** Parent-dir extractor — handles both '/' and '\' separators for Windows compat. */
const parentDir = (p: string): string => {
  if (!p) return '';
  // Match trailing segment after the LAST '/' or '\' — greedy, cross-platform
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(0, idx) : '';
};

/** Invalidate a single dir cache entry — call after any mutation under that dir. */
export const invalidateDirCache = (dirPath: string) => {
  if (!dirPath) return;
  dirCache.delete(dirPath);
};

/** Clear the entire dir cache — call on vault switch / lock / unlock. */
export const clearDirCache = () => { dirCache.clear(); };

/**
 * Cached `read_directory` wrapper. Returns ReadDirResponse (same shape as
 * direct invoke). Skips the cache in `isWeb` mode — callers should call
 * mockReadDirectory directly there.
 */
export const readDirectoryCached = async (dirPath: string): Promise<ReadDirResponse> => {
  if (isWeb || !dirPath) return { files: [] };
  const now = Date.now();
  const hit = dirCache.get(dirPath);
  if (hit && now - hit.at < DIR_CACHE_TTL_MS) {
    // LRU touch
    dirCache.delete(dirPath);
    dirCache.set(dirPath, hit);
    return hit.res;
  }
  const res: ReadDirResponse = await invoke('read_directory', { dir: dirPath });
  if (dirCache.size >= DIR_CACHE_MAX) {
    const oldest = dirCache.keys().next().value;
    if (oldest !== undefined) dirCache.delete(oldest);
  }
  dirCache.set(dirPath, { res, at: now });
  return res;
};

// ---------------------------------------------------------------------------
// Zip import — wraps the Rust `import_zip_to_vault` command.
// Contract: target_abs_path MUST be a fresh path (deduped by the caller).
// Rust returns ImportZipResult on success or a tagged ImportZipError on
// failure. Callers should pattern-match on error.kind.
// ---------------------------------------------------------------------------

export interface SkippedEntry { path: string; reason: string; }

export interface ImportZipResult {
  targetPath: string;
  filesImported: number;
  dirsImported: number;
  skipped: SkippedEntry[];
  cancelled: boolean;
  elapsedMs: number;
}

export type ImportZipError =
  | { kind: 'invalidZip'; reason: string }
  | { kind: 'zipSlip'; path: string }
  | { kind: 'bombRatio' }
  | { kind: 'tooLarge' }
  | { kind: 'tooManyEntries' }
  | { kind: 'encryptedNotSupported' }
  | { kind: 'targetExists'; path: string }
  | { kind: 'emptyZip' }
  | { kind: 'cancelled' }
  | { kind: 'io'; reason: string };

export const importZipToVault = (zipPath: string, targetAbsPath: string) =>
  invoke<ImportZipResult>('import_zip_to_vault', { zipPath, targetAbsPath });

// ---------------------------------------------------------------------------
// Settings I/O — via Rust invoke (absolute paths, no BaseDirectory anchor)
// ---------------------------------------------------------------------------

export const readGlobalSettings = async (): Promise<any> => {
  if (isWeb) return {};
  try {
    const json = await invoke<string>('read_global_settings');
    return JSON.parse(json || '{}');
  } catch (e) {
    console.warn('readGlobalSettings failed:', e);
    return {};
  }
};

// Debounced global settings writer
let _globalWriteTimer: ReturnType<typeof setTimeout> | null = null;
let _globalWriteResolve: (() => void) | null = null;
let _pendingGlobalJson: any = null;

const _flushGlobalWrite = async () => {
  const json = _pendingGlobalJson;
  _pendingGlobalJson = null;
  const resolve = _globalWriteResolve;
  _globalWriteResolve = null;
  try {
    await invoke('write_global_settings', { json: JSON.stringify(json) });
  } catch (e) {
    handleError(e);
  }
  resolve?.();
};

export const writeGlobalSettings = (settingJson: any): Promise<void> => {
  _pendingGlobalJson = settingJson;
  if (_globalWriteTimer) clearTimeout(_globalWriteTimer);
  return new Promise<void>((resolve) => {
    _globalWriteResolve = resolve;
    _globalWriteTimer = setTimeout(_flushGlobalWrite, 300);
  });
};

export const readVaultSettings = async (vaultPath?: string): Promise<any> => {
  if (isWeb) return {};
  const vp = vaultPath || _vaultPath;
  if (!vp) return {};
  try {
    const json = await invoke<string>('read_vault_settings', { vaultPath: vp });
    return JSON.parse(json || '{}');
  } catch (e) {
    console.warn('readVaultSettings failed:', e);
    return {};
  }
};

// Debounced vault settings writer
let _vaultWriteTimer: ReturnType<typeof setTimeout> | null = null;
let _vaultWriteResolve: (() => void) | null = null;
let _pendingVaultJson: any = null;

const _flushVaultWrite = async () => {
  const json = _pendingVaultJson;
  _pendingVaultJson = null;
  const resolve = _vaultWriteResolve;
  _vaultWriteResolve = null;
  try {
    await invoke('write_vault_settings', { vaultPath: _vaultPath, json: JSON.stringify(json) });
  } catch (e) {
    handleError(e);
  }
  resolve?.();
};

export const writeVaultSettings = (settingJson: any): Promise<void> => {
  _pendingVaultJson = settingJson;
  if (_vaultWriteTimer) clearTimeout(_vaultWriteTimer);
  return new Promise<void>((resolve) => {
    _vaultWriteResolve = resolve;
    _vaultWriteTimer = setTimeout(_flushVaultWrite, 300);
  });
};

/** Read vault settings, preferring the pending (not yet flushed) write if available.
 *  This avoids read-modify-write races where a debounced write hasn't landed on disk yet. */
export const readVaultSettingsLatest = async (): Promise<any> => {
  if (_pendingVaultJson) return structuredClone(_pendingVaultJson);
  return readVaultSettings();
};

// ---------------------------------------------------------------------------
// Graceful shutdown helpers
// ---------------------------------------------------------------------------

/** Registry for editor debounce flush — set by app-editor-panel on mount. */
let _editorFlushFn: (() => Promise<void> | undefined) | null = null;
export const registerEditorFlush = (fn: () => Promise<void> | undefined) => { _editorFlushFn = fn; };
export const unregisterEditorFlush = () => { _editorFlushFn = null; };

/** Flush all pending debounced writes (editor + settings) before quit. */
export const flushAllPendingWrites = async (): Promise<void> => {
  const promises: Promise<void>[] = [];
  // Flush editor debounce
  const editorResult = _editorFlushFn?.();
  if (editorResult) promises.push(editorResult);
  // Flush global settings debounce
  if (_globalWriteTimer) {
    clearTimeout(_globalWriteTimer);
    _globalWriteTimer = null;
  }
  if (_pendingGlobalJson) promises.push(_flushGlobalWrite());
  // Flush vault settings debounce
  if (_vaultWriteTimer) {
    clearTimeout(_vaultWriteTimer);
    _vaultWriteTimer = null;
  }
  if (_pendingVaultJson) promises.push(_flushVaultWrite());
  if (promises.length) await Promise.all(promises);
};


/** Create example note if vault is empty. */
export const createExampleNote = async () => {
  const vp = _vaultPath;
  if (!vp) return;
  try {
    // Check if vault has any .md files by reading directory
    const res = await readDirectoryCached(vp);
    const files = res?.files ?? [];
    const hasMd = files.some(f => f.file_name.endsWith('.md'));
    if (!hasMd) {
      await invoke('write_file', { filePath: `${vp}/Example Note.md`, text: EXAMPLE_NOTE });
    }
  } catch {
    // Ignore — vault may not be readable yet
  }
};

export const initVault = async (vaultPath: string): Promise<void> => {
  if (isWeb || !vaultPath) return;
  await invoke('init_vault', { vaultPath });
};

export const initApp = async () => {
  // 1. Read global settings (Rust already ran legacy migration)
  const global = await readGlobalSettings();

  // 2. Get vault path from storage info (provider already init'd by Rust)
  const info = await getStorageInfo();
  const vaultPath = info?.location || '';
  setVaultPath(vaultPath);

  // 3. Bootstrap global settings fields that may be missing on first launch
  let globalDirty = false;
  if (!global.clientUuid) {
    const { v4: uuidV4 } = await import('uuid');
    global.clientUuid = uuidV4();
    globalDirty = true;
  }
  if (!global.lastOpenedVault && vaultPath) {
    global.lastOpenedVault = vaultPath;
    globalDirty = true;
  }
  if (globalDirty) {
    await invoke('write_global_settings', { json: JSON.stringify(global) });
  }

  // 4. Ensure vault .binderus/ exists with defaults
  if (vaultPath) {
    try {
      await initVault(vaultPath);
    } catch (e) {
      // Non-fatal: vault path may be stale or point to a non-directory (os error 20)
      console.warn('initVault failed:', e);
    }
  }

  // 5. Read vault settings
  const vault = await readVaultSettings(vaultPath);

  // 6. Create example note for first-time users
  await createExampleNote();

  // 7. Merge for backward compatibility with App.tsx consumers
  return { ...global, ...vault, _vaultPath: vaultPath };
};

export const renameFile = async (file: FileType, newName: string) => {
  try {
    await invoke('rename_file_cmd', { filePath: file?.file_path, newName });
    // File renamed in-place → parent dir's listing changed
    invalidateDirCache(parentDir(file?.file_path ?? ''));
    // Drop the old-path read cache entry so re-open pulls fresh
    if (file?.file_path) invalidateReadCache(file.file_path);
  } catch (e) {
    handleError(e);
  }
};

export const moveFiles = async (filePaths: string[], destDir: string) => {
  try {
    await invoke('move_files', { filePaths, destDir });
    // Invalidate both source dirs (unique) and the destination
    const sourceDirs = new Set(filePaths.map(parentDir));
    sourceDirs.forEach(invalidateDirCache);
    invalidateDirCache(destDir);
    // Drop moved files from the read cache — they live at new paths now
    filePaths.forEach(invalidateReadCache);
  } catch (e) {
    handleError(e);
  }
};

export const selectDir = async (defaultPath?: string) => {
  const dirPath = await dialogOpen({
    title: `Open Folder`,
    directory: true,
    multiple: false,
    defaultPath: defaultPath ?? '/',
    filters: [{ name: 'dir', extensions: ['md', 'json'] }]
  });
  return dirPath;
};

// dirPath must be the absolute path of the directory to delete
export const deleteDir = async (dirPath: string) => {
  try {
    await invoke('delete_dir', { dirPath });
    // Parent's listing changed + this dir's own cached listing is dead
    invalidateDirCache(parentDir(dirPath));
    invalidateDirCache(dirPath);
  } catch (e) {
    handleError(e);
  }
};

// take a path, get files under that directory, and return FileType item for that file
// example: http://localhost:1420/directory/file1.md => return FileType of 'file1.md' (if found)
export const getFileFromInternalLink = async (href = '') => {
  const linkPath = sanitizeInternalLink(href);
  const arr = linkPath.split('/');
  const fileName = (arr.pop() ?? '').toLowerCase();

  let dirPath = (await getPath('', true)) + arr.join('/');
  dirPath = dirPath.replace(/\%20/g, ' ').replace(/\\\\/g, '');
  const res = await readDirectoryCached(dirPath);
  const dirFiles = (res?.files as FileType[]) ?? [];

  const matchedItem = dirFiles.find((obj) => obj.file_name.toLowerCase().indexOf(fileName) >= 0);
  return matchedItem;
};

export const openLink = (url: string) => {
  if (!url) {
    return;
  }
  if (isWeb) {
    window.open(url);
  } else {
    tauriOpen(url);
  }
};

export type StorageInfo = {
  name: string;
  supports_encryption: boolean;
  supports_sync: boolean;
  supports_search_index: boolean;
  location: string;
};

export type LockStatus = {
  is_locked: boolean;
  encryption_enabled: boolean;
};

export const getStorageInfo = async (): Promise<StorageInfo | null> => {
  if (isWeb) return null;
  try {
    return await invoke<StorageInfo>('get_storage_info');
  } catch (e) {
    console.error('getStorageInfo failed:', e);
    return null;
  }
};

export const getLockStatus = async (): Promise<LockStatus | null> => {
  if (isWeb) return null;
  try {
    return await invoke<LockStatus>('get_lock_status');
  } catch (e) {
    console.error('getLockStatus failed:', e);
    return null;
  }
};

export const lockDb = async (): Promise<void> => {
  if (isWeb) return;
  try {
    await invoke('lock_db');
  } catch (e) {
    console.error('lockDb failed:', e);
  }
};

export const unlockDb = async (passphrase: string): Promise<void> => {
  if (isWeb) return;
  await invoke('unlock_db', { passphrase });
};

export const getStartupError = async (): Promise<string | null> => {
  if (isWeb) return null;
  return await invoke<string | null>('get_startup_error');
};

export const migrateToDb = async (passphrase?: string, force = false): Promise<{ files_imported: number; dirs_imported: number }> => {
  return await invoke('migrate_fs_to_db', { passphrase: passphrase || null, force });
};

export const checkDbPassphrase = async (passphrase?: string): Promise<'no_db' | 'db_exists' | 'unlocked' | 'locked'> => {
  return await invoke('check_db_passphrase', { passphrase: passphrase || null });
};

export const quitApp = async (): Promise<void> => {
  await invoke('quit_app');
};

export type ExportStats = {
  files_exported: number;
  dirs_exported: number;
};

export const exportDbToFs = async (targetDir: string): Promise<ExportStats> => {
  return await invoke<ExportStats>('export_db_to_fs', { targetDir });
};

/** Delete the libsql DB files, write filesystem mode to settings, then quit. */
export const resetToFilesystem = async (): Promise<void> => {
  await invoke('reset_to_filesystem');
};

// ---------------------------------------------------------------------------
// Duplicate — create a sibling copy with a unique "foo copy.md" name.
// Recursive for folders. Binary files (by extension) are skipped with a
// console.warn rather than corrupted via UTF-8 round-trip; a binary-safe
// Rust `duplicate_files` command is a follow-up.
// ---------------------------------------------------------------------------

const BINARY_EXTS = new Set([
  'png','jpg','jpeg','gif','webp','bmp','ico','svg','heic','heif',
  'mp3','wav','ogg','flac','aac','m4a',
  'mp4','mov','avi','mkv','webm','m4v',
  'pdf','zip','tar','gz','7z','rar','dmg','exe','bin','so','dylib',
  'ttf','otf','woff','woff2',
]);

const looksBinary = (name: string): boolean => {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return BINARY_EXTS.has(name.slice(dot + 1).toLowerCase());
};

const splitStemExt = (name: string): [string, string] => {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return [name, ''];
  return [name.slice(0, dot), name.slice(dot)];
};

const siblingExists = async (parent: string, name: string): Promise<boolean> => {
  invalidateDirCache(parent);
  const res = await readDirectoryCached(parent);
  return !!res.files?.some((f) => f.file_name === name);
};

const findUniqueDuplicateName = async (parent: string, origName: string): Promise<string> => {
  const [stem, ext] = splitStemExt(origName);
  let candidate = `${stem} copy${ext}`;
  if (!(await siblingExists(parent, candidate))) return candidate;
  for (let n = 2; n < 1000; n++) {
    candidate = `${stem} copy ${n}${ext}`;
    if (!(await siblingExists(parent, candidate))) return candidate;
  }
  throw new Error(`duplicateItem: no unique name for ${origName} after 1000 attempts`);
};

const duplicateAtPath = async (srcPath: string, destPath: string, isDir: boolean): Promise<void> => {
  if (isDir) {
    await invoke('create_dir_recursive', { dirPath: destPath });
    const res = await readDirectoryCached(srcPath);
    for (const child of res.files ?? []) {
      const childDest = `${destPath}/${child.file_name}`;
      await duplicateAtPath(child.file_path, childDest, child.is_dir);
    }
  } else {
    if (looksBinary(srcPath)) {
      console.warn('duplicateItem: skipping binary file (UTF-8 round-trip unsafe):', srcPath);
      return;
    }
    const text = await readFileCached(srcPath);
    await writeFileCached(destPath, text);
  }
};

/**
 * Duplicate a file or folder in place (creates a sibling with a
 * "foo copy.md" / "foo copy 2.md" name). Recursive for folders.
 * Returns the new path on success, null on failure.
 */
export const duplicateItem = async (item: FileType): Promise<string | null> => {
  try {
    const parent = item.file_path.slice(
      0,
      Math.max(item.file_path.lastIndexOf('/'), item.file_path.lastIndexOf('\\'))
    );
    if (!parent) return null;
    const newName = await findUniqueDuplicateName(parent, item.file_name);
    const newPath = `${parent}/${newName}`;
    await duplicateAtPath(item.file_path, newPath, item.is_dir);
    invalidateDirCache(parent);
    return newPath;
  } catch (e) {
    handleError(e);
    return null;
  }
};
