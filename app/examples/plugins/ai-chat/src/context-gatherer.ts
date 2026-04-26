/**
 * Description: Resolves the chosen ContextMode into a string suitable for
 *   prepending to the user prompt. Uses the host-provided `read_file` /
 *   `read_directory` Tauri commands to pull content from the vault.
 * Inputs: ContextMode + PluginContext + optional list of file paths / dir path.
 * Outputs: a single string; caller caps it at settings.maxContextChars.
 */

import { invoke } from '@tauri-apps/api/core';
import type { PluginContext } from './host-types';
import type { ContextMode } from './types';

/**
 * Shape returned by the host's `read_directory` command. Each `FileMeta`
 * entry represents a single direct child of the queried directory —
 * either a file or a subfolder. The plugin walks subfolders itself to
 * recurse with depth + count caps.
 */
export interface ReadDirResponse {
  number_of_files?: number;
  files: Array<{
    file_path: string;
    file_name?: string;
    is_dir?: boolean;
    is_file?: boolean;
  }>;
}

// Generous allowlist of extensions commonly used for plain-text notes,
// prose, config, and code. Anything not matched falls through to the
// binary-byte sniff in isLikelyText().
const TEXT_EXT = new Set([
  // prose
  'md', 'markdown', 'mdx', 'txt', 'text', 'rst', 'org', 'adoc', 'asciidoc',
  // data / config
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env', 'csv', 'tsv',
  'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  // code (extend as needed — bundle stays tiny either way)
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java',
  'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'lua', 'pl',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'r', 'jl', 'ex', 'exs',
  // docs
  'tex', 'bib', 'log',
]);

// Extensionless filenames that are conventionally plain text.
const TEXT_FILENAMES = new Set([
  'readme', 'license', 'licence', 'changelog', 'authors', 'contributors',
  'makefile', 'dockerfile', 'procfile', 'gemfile', 'rakefile',
  '.gitignore', '.gitattributes', '.editorconfig', '.prettierrc', '.eslintrc',
]);

// Hard limits to stop an accidental click on a giant folder (e.g. the
// vault root) from stalling the UI. Tune if they bite.
const MAX_DIR_DEPTH = 2;
const MAX_FILES_PER_DIR_SCAN = 30;

function basename(path: string): string {
  const normalised = path.replace(/\\/g, '/');
  const idx = normalised.lastIndexOf('/');
  return idx >= 0 ? normalised.slice(idx + 1) : normalised;
}

function extOf(path: string): string {
  const name = basename(path);
  const idx = name.lastIndexOf('.');
  // Treat leading-dot files (".gitignore") as having no extension.
  if (idx <= 0) return '';
  return name.slice(idx + 1).toLowerCase();
}

/**
 * Quick allowlist check by filename alone. Returns `true` for a known
 * text extension or a well-known extensionless filename, `false`
 * otherwise (caller may still sniff). Kept synchronous — no I/O.
 */
function isTextByName(path: string): boolean {
  const name = basename(path).toLowerCase();
  if (TEXT_FILENAMES.has(name)) return true;
  const ext = extOf(path);
  return ext !== '' && TEXT_EXT.has(ext);
}

/**
 * Looks at the first chunk of actual bytes — if we find a NUL byte or
 * too many non-printable control chars, call it binary. Good enough
 * for "don't paste a PNG into the LLM prompt".
 *
 * Operates on the string returned by `read_file` (already UTF-8
 * decoded by the host), so a NUL byte in text survives as `'\x00'`.
 */
function isLikelyText(content: string): boolean {
  if (content.length === 0) return true;
  const sample = content.length > 8192 ? content.slice(0, 8192) : content;
  if (sample.indexOf('\x00') !== -1) return false;
  let controls = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    // Allow TAB (9), LF (10), CR (13); count other < 32 as control.
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) controls++;
  }
  return controls / sample.length < 0.02;
}

/** Last-known selection captured via the `editor-selection-change` window event. */
let latestSelection: { text: string; path: string | null } = { text: '', path: null };

export function installSelectionListener(): () => void {
  const handler = (e: Event) => {
    const ce = e as CustomEvent<{ text: string; from?: number; to?: number }>;
    latestSelection = {
      text: ce.detail?.text ?? '',
      path: null, // host doesn't pass path yet; we infer from active doc when used
    };
  };
  window.addEventListener('editor-selection-change', handler);
  return () => window.removeEventListener('editor-selection-change', handler);
}

export function getCachedSelection(): string {
  return latestSelection.text;
}

async function readFileSafe(path: string): Promise<string> {
  try {
    const content = (await invoke('read_file', { filePath: path })) as string | null | undefined;
    return content ?? '';
  } catch (err) {
    console.warn('[ai-chat] read_file failed', path, err);
    return '';
  }
}

interface ScanResult {
  candidates: string[];
  /** True when we stopped walking because MAX_FILES_PER_DIR_SCAN was hit. */
  hitFileCap: boolean;
  /** True when at least one subtree was pruned at MAX_DIR_DEPTH. */
  hitDepthCap: boolean;
}

async function readDirRecursive(
  dir: string,
  depth: number,
  acc: ScanResult,
): Promise<void> {
  if (acc.candidates.length >= MAX_FILES_PER_DIR_SCAN) {
    acc.hitFileCap = true;
    return;
  }
  if (depth > MAX_DIR_DEPTH) {
    acc.hitDepthCap = true;
    return;
  }
  try {
    const res = (await invoke('read_directory', { dir })) as ReadDirResponse;
    const entries = res.files ?? [];
    for (const entry of entries) {
      if (acc.candidates.length >= MAX_FILES_PER_DIR_SCAN) {
        acc.hitFileCap = true;
        return;
      }
      const path = entry.file_path;
      if (!path) continue;
      const isDir = entry.is_dir === true;
      // Host's FsProvider may omit is_file; treat a non-dir entry with
      // a path as a file by default.
      const isFile = entry.is_file === true || (!isDir && entry.is_file !== false);
      if (isDir) {
        await readDirRecursive(path, depth + 1, acc);
      } else if (isFile && isTextByName(path)) {
        acc.candidates.push(path);
      }
    }
  } catch (err) {
    console.warn('[ai-chat] read_directory failed', dir, err);
  }
}

function formatFileBlock(path: string, content: string): string {
  return `\n\n===== FILE: ${path} =====\n${content}\n===== END FILE =====\n`;
}

export interface GatherArgs {
  mode: ContextMode;
  ctx: PluginContext;
  selectedFiles?: string[];
  directoryPath?: string;
  maxChars: number;
}

export interface GatherResult {
  text: string;
  truncated: boolean;
  sources: string[];
  warnings: string[];
  /** How many files were discovered by the scan (pre-cap). */
  filesConsidered: number;
  /** How many of those were actually included in the prompt. */
  filesIncluded: number;
  /** Files rejected by the binary sniff, for diagnostics. */
  filesSkippedBinary: number;
}

function capAt(chunks: string[], max: number): { text: string; truncated: boolean } {
  let out = '';
  for (const c of chunks) {
    if (out.length + c.length <= max) {
      out += c;
    } else {
      const remaining = max - out.length;
      if (remaining > 0) out += c.slice(0, remaining);
      return { text: out, truncated: true };
    }
  }
  return { text: out, truncated: false };
}

function emptyResult(warnings: string[]): GatherResult {
  return {
    text: '',
    truncated: false,
    sources: [],
    warnings,
    filesConsidered: 0,
    filesIncluded: 0,
    filesSkippedBinary: 0,
  };
}

/**
 * Read every path, drop binary files, return markdown-fenced blocks +
 * the matching source list in the same order. Unknown-extension files
 * (e.g. `README` with no suffix) are run through `isLikelyText` after
 * reading; obvious binaries never make it into the prompt.
 */
async function blocksFromPaths(
  paths: string[],
  warnings: string[],
): Promise<{ blocks: string[]; sources: string[]; skippedBinary: number }> {
  const blocks: string[] = [];
  const sources: string[] = [];
  let skippedBinary = 0;
  for (const p of paths) {
    const content = await readFileSafe(p);
    if (!content) continue;
    if (!isLikelyText(content)) {
      skippedBinary++;
      continue;
    }
    blocks.push(formatFileBlock(p, content));
    sources.push(p);
  }
  if (skippedBinary > 0) {
    warnings.push(`Skipped ${skippedBinary} binary file(s).`);
  }
  return { blocks, sources, skippedBinary };
}

export async function gatherContext(args: GatherArgs): Promise<GatherResult> {
  const warnings: string[] = [];

  switch (args.mode) {
    case 'editor': {
      const doc = args.ctx.editor.getActiveDocument();
      if (!doc || !doc.path) {
        warnings.push('No active editor tab.');
        return emptyResult(warnings);
      }
      // The host may expose an empty `content` for tabs that haven't
      // been hydrated yet (e.g. restored from persistence). Fall back
      // to a direct read so the model sees the real file contents.
      const raw = doc.content && doc.content.length > 0
        ? doc.content
        : await readFileSafe(doc.path);
      const { text, truncated } = capAt([formatFileBlock(doc.path, raw)], args.maxChars);
      return {
        text, truncated, warnings,
        sources: [doc.path],
        filesConsidered: 1,
        filesIncluded: text ? 1 : 0,
        filesSkippedBinary: 0,
      };
    }

    case 'selection': {
      const selection = getCachedSelection();
      if (selection.trim() === '') {
        warnings.push('No selection captured — falling back to full editor content.');
        const doc = args.ctx.editor.getActiveDocument();
        const raw = doc && doc.path
          ? (doc.content && doc.content.length > 0 ? doc.content : await readFileSafe(doc.path))
          : '';
        const block = doc && doc.path ? formatFileBlock(doc.path, raw) : '';
        const { text, truncated } = capAt([block], args.maxChars);
        return {
          text, truncated, warnings,
          sources: doc?.path ? [doc.path] : [],
          filesConsidered: doc?.path ? 1 : 0,
          filesIncluded: text ? 1 : 0,
          filesSkippedBinary: 0,
        };
      }
      const { text, truncated } = capAt(
        [`\n\n===== SELECTION =====\n${selection}\n===== END SELECTION =====\n`],
        args.maxChars,
      );
      return {
        text, truncated, warnings,
        sources: ['editor-selection'],
        filesConsidered: 0,
        filesIncluded: 0,
        filesSkippedBinary: 0,
      };
    }

    case 'files': {
      const paths = args.selectedFiles ?? [];
      if (paths.length === 0) {
        warnings.push('No files selected.');
        return emptyResult(warnings);
      }
      const { blocks, sources, skippedBinary } = await blocksFromPaths(paths, warnings);
      const { text, truncated } = capAt(blocks, args.maxChars);
      // filesIncluded counts blocks that actually survived truncation.
      const filesIncluded = truncated
        ? Math.max(0, sources.length - countTruncatedBlocks(blocks, args.maxChars))
        : sources.length;
      return {
        text, truncated, sources, warnings,
        filesConsidered: paths.length,
        filesIncluded,
        filesSkippedBinary: skippedBinary,
      };
    }

    case 'directory': {
      const dir = args.directoryPath?.trim();
      if (!dir) {
        warnings.push('No directory path provided.');
        return emptyResult(warnings);
      }
      const scan: ScanResult = { candidates: [], hitFileCap: false, hitDepthCap: false };
      await readDirRecursive(dir, 0, scan);
      if (scan.hitFileCap) {
        warnings.push(`Scan stopped at ${MAX_FILES_PER_DIR_SCAN} files — pick a smaller folder.`);
      }
      if (scan.hitDepthCap) {
        warnings.push(`Subfolders beyond depth ${MAX_DIR_DEPTH} were skipped.`);
      }
      if (scan.candidates.length === 0) {
        warnings.push(`No text files found under ${dir}.`);
        return emptyResult(warnings);
      }
      const { blocks, sources, skippedBinary } = await blocksFromPaths(scan.candidates, warnings);
      const { text, truncated } = capAt(blocks, args.maxChars);
      const filesIncluded = truncated
        ? Math.max(0, sources.length - countTruncatedBlocks(blocks, args.maxChars))
        : sources.length;
      return {
        text, truncated, sources, warnings,
        filesConsidered: scan.candidates.length,
        filesIncluded,
        filesSkippedBinary: skippedBinary,
      };
    }
  }
}

/**
 * Roughly count how many trailing blocks would be dropped entirely by
 * `capAt` — used to derive `filesIncluded` without re-capping. Blocks
 * are independent, so the first one that overflows is the cut-off; any
 * block after it is fully excluded.
 */
function countTruncatedBlocks(blocks: string[], max: number): number {
  let running = 0;
  for (let i = 0; i < blocks.length; i++) {
    running += blocks[i].length;
    if (running > max) return blocks.length - i;
  }
  return 0;
}
