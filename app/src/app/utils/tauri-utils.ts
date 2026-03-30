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
export const setVaultPath = (p: string) => { _vaultPath = p; };

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
  } catch (e) {
    handleError(e);
  }
};

export const newFile = async (filePath: string, newFileName: string) => {
  try {
    const base = filePath || (await getPath('', true));
    await invoke('write_file', { filePath: `${base}/${newFileName}.md`, text: '' });
  } catch (e) {
    handleError(e);
  }
};

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


/** Create example note if vault is empty. */
export const createExampleNote = async () => {
  const vp = _vaultPath;
  if (!vp) return;
  try {
    // Check if vault has any .md files by reading directory
    const res: ReadDirResponse = await invoke('read_directory', { dir: vp });
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
  } catch (e) {
    handleError(e);
  }
};

export const moveFiles = async (filePaths: string[], destDir: string) => {
  try {
    await invoke('move_files', { filePaths, destDir });
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
  const res: ReadDirResponse = await invoke('read_directory', { dir: dirPath });
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
