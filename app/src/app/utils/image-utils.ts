/**
 * Description: Image paste/drop helpers. Writes pasted images to the vault as files
 *   (FS mode) and returns a relative POSIX path for the markdown link. Resolves
 *   relative image src values to asset:// URLs at render time so the webview can
 *   load them. Enforces the "never base64-inline" invariant from
 *   docs/plans/2026-04-21-editor-paste-image-to-file.md §7.2.
 * Requirements: @tauri-apps/plugin-fs (writeFile, mkdir, exists), Web Crypto SubtleCrypto.
 * Inputs: Blob (from ClipboardEvent / DataTransfer); raw image src string.
 * Outputs: relative vault path like "_images/2026-04-21/a1b2c3d4e5f6.png";
 *   resolved asset:// URL.
 */
import { writeFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getVaultPath } from './tauri-utils';
import { isInternalLink, sanitizeInternalLink } from './base-utils';
import { useAppStore } from '../hooks/use-app-store';

export const MAX_PASTE_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB — matches plan §7.1
export const IMAGES_FOLDER = '_images';

// Allowlist of MIME types we accept from the clipboard / drop. Anything else is rejected
// so we never write arbitrary binary under the vault.
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
};

export type SaveImageErrorCode =
  | 'no-vault'
  | 'too-large'
  | 'unsupported-type'
  | 'write-failed';

export type SaveImageResult =
  | { ok: true; relPath: string }
  | { ok: false; error: SaveImageErrorCode; detail?: string };

async function shortHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const full = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  // 12 hex chars = 48 bits. Birthday-safe past 2^24 files per vault (see plan §13.7).
  return full.slice(0, 12);
}

function todayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Join path segments with POSIX slashes (Tauri fs accepts forward slashes on all platforms). */
function joinPosix(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter((p) => p.length > 0)
    .join('/');
}

/** True when the active vault is backed by libsql (DB mode). */
export function isDbMode(): boolean {
  return useAppStore.getState().storageBackend !== 'filesystem';
}

/**
 * Resolve a vault-relative image path to the absolute path used by
 * `get_file_metadata` / `set_file_metadata` commands. Returns null when no
 * vault is open or the relative path is malformed. Mirrors the join logic
 * used inside `saveImageToVault` so metadata lookups hit the same key.
 */
export function absFilePathFromRel(relPath: string): string | null {
  const vault = getVaultPath();
  if (!vault || !relPath) return null;
  if (relPath.split('/').some((seg) => seg === '..')) return null;
  return joinPosix(vault, relPath.replace(/^\/+/, ''));
}

/**
 * Delete the file/blob backing a vault-relative image src. In FS mode, unlinks the file.
 * In DB mode, deletes the row from the sidecar blob DB (lookup by hash from the filename).
 * Caller is responsible for any UX confirmation — this function just performs the op.
 * Returns true on success, false if the vault isn't open or the delete failed.
 */
export async function deleteImageFromVault(relPath: string): Promise<boolean> {
  const vault = getVaultPath();
  if (!vault) return false;
  if (!relPath || relPath.split('/').some((seg) => seg === '..')) return false;

  const absFile = joinPosix(vault, relPath.replace(/^\/+/, ''));

  if (isDbMode()) {
    const hash = hashFromRelPath(relPath);
    if (!hash) return false;
    try {
      // Deletes the blob file and the corresponding files-table row.
      await invoke<void>('delete_image_blob', { hash, filePath: absFile });
      return true;
    } catch {
      return false;
    }
  }
  try {
    await invoke<boolean>('delete_file', { filePath: absFile });
    return true;
  } catch {
    return false;
  }
}

/** Extract the short sha256 from an image's vault-relative path filename stem.
 *  Mirrors the Rust-side `hash_from_path` so DB lookups agree. Returns "" on malformed. */
export function hashFromRelPath(rel: string): string {
  const basename = rel.split('/').pop() ?? rel;
  const dot = basename.lastIndexOf('.');
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  if (stem.length >= 10 && stem.length <= 32 && /^[0-9a-fA-F]+$/.test(stem)) {
    return stem.toLowerCase();
  }
  return '';
}

/**
 * Save a pasted/dropped image to the vault.
 * Returns the POSIX relative path to use as markdown src, or an error code.
 * Never produces a base64 data URI.
 */
export async function saveImageToVault(blob: Blob): Promise<SaveImageResult> {
  const vault = getVaultPath();
  if (!vault) return { ok: false, error: 'no-vault' };

  if (blob.size > MAX_PASTE_IMAGE_BYTES) {
    return { ok: false, error: 'too-large' };
  }

  const ext = MIME_TO_EXT[blob.type.toLowerCase()];
  if (!ext) {
    return { ok: false, error: 'unsupported-type', detail: blob.type || '(unknown)' };
  }

  try {
    const bytes = await blob.arrayBuffer();
    const hash = await shortHash(bytes);
    const date = todayLocal();
    const relPath = joinPosix(IMAGES_FOLDER, date, `${hash}.${ext}`);
    // Emit with a leading `/` so the markdown reads as vault-root absolute
    // (GitHub convention). `resolveImageSrc` strips it for internal lookup.
    const markdownPath = `/${relPath}`;
    const absFile = joinPosix(vault, relPath);

    if (isDbMode()) {
      // DB mode: bytes land in the filesystem blob store under .binderus/blobs/,
      // keyed by 12-char sha256 hash (encrypted via AEAD when a vault passphrase
      // is set). Description/summary (if any) go to the `image_metadata` table,
      // also keyed by hash. No row is inserted into the main DB's `files` table,
      // so pasted images don't appear in the sidebar tree (`_images/` is an
      // FS-mode concept). See plan §12 / §16 and migration V002 (item_metadata.blob_hash).
      await invoke<void>('write_image_blob', {
        hash,
        filePath: absFile,
        mime: blob.type || `image/${ext}`,
        bytes: Array.from(new Uint8Array(bytes)),
      });
      return { ok: true, relPath: markdownPath };
    }

    const absDir = joinPosix(vault, IMAGES_FOLDER, date);
    await mkdir(absDir, { recursive: true }).catch(() => {
      // mkdir is idempotent; ignore "already exists". A real permission error
      // will surface on writeFile below.
    });

    // Dedupe: same content hash → skip the write (plan §7.1 step 7).
    const already = await exists(absFile).catch(() => false);
    if (!already) {
      await writeFile(absFile, new Uint8Array(bytes));
    }
    return { ok: true, relPath: markdownPath };
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, error: 'write-failed', detail };
  }
}

/**
 * Collapse `.` and `..` segments in a POSIX-style path. Does not touch the
 * leading slash (if any). Returns a path that may still be relative or absolute
 * depending on input; `..` popping stops at the path root (no escape).
 */
function normalizePosixPath(p: string): string {
  const leading = p.startsWith('/') ? '/' : '';
  const parts = p.split('/').filter((s) => s.length > 0);
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return leading + out.join('/');
}

/**
 * Resolve an image src for the webview.
 * - data: / http(s): / asset: / tauri: / blob: / bin-img: → returned unchanged.
 * - Leading `/` → vault-root absolute (GitHub convention).
 * - No leading `/` → relative to the active note's directory (CommonMark).
 *   Falls back to vault-root if no note is active.
 * - No vault → input returned unchanged (webview will show a broken image).
 */
export function resolveImageSrc(raw: string): string {
  if (!raw) return raw;
  const s = raw.trim();
  if (
    s.startsWith('data:') ||
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('asset:') ||
    s.startsWith('tauri:') ||
    s.startsWith('blob:') ||
    s.startsWith('bin-img:')
  ) {
    return s;
  }
  const vault = getVaultPath();
  if (!vault) return s;
  // Webview sometimes rewrites relative srcs to "http://localhost:1420/<rel>". Normalize back.
  let rel = s;
  if (isInternalLink(rel)) rel = sanitizeInternalLink(rel);

  // Resolve to a vault-relative POSIX path.
  let vaultRel: string;
  if (rel.startsWith('/')) {
    vaultRel = rel.replace(/^\/+/, '');
  } else {
    const activeAbs = useAppStore.getState().activeTabPath;
    if (activeAbs) {
      // Strip vault prefix, then drop basename to get the note's dir.
      const vaultNorm = vault.replace(/\\/g, '/').replace(/\/+$/, '');
      const activeNorm = activeAbs.replace(/\\/g, '/');
      const activeRel = activeNorm.startsWith(vaultNorm)
        ? activeNorm.slice(vaultNorm.length).replace(/^\/+/, '')
        : activeNorm.replace(/^\/+/, '');
      const lastSlash = activeRel.lastIndexOf('/');
      const noteDir = lastSlash >= 0 ? activeRel.slice(0, lastSlash) : '';
      vaultRel = noteDir ? `${noteDir}/${rel}` : rel;
    } else {
      vaultRel = rel; // fallback: vault-root
    }
  }
  vaultRel = normalizePosixPath(vaultRel).replace(/^\/+/, '');

  // DB mode: route through the custom URI scheme handler that streams bytes from libsql.
  // FS mode: use the Tauri asset protocol so the webview reads bytes directly from disk.
  if (isDbMode()) {
    return `bin-img://localhost/${vaultRel.split('/').map(encodeURIComponent).join('/')}`;
  }
  return convertFileSrc(joinPosix(vault, vaultRel));
}
