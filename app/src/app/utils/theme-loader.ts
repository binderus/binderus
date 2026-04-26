/**
 * Description: Custom theme filesystem loader for Binderus. Discovers user CSS theme
 *   files in $APPDATA/themes/, parses metadata, sanitizes CSS, and caches CSS for
 *   loadTheme() to inject. Also opens the themes folder via shell.
 * Requirements: @tauri-apps/plugin-fs, @tauri-apps/api/path, @tauri-apps/plugin-shell
 * Inputs: CSS files from $APPDATA/themes/
 * Outputs: ThemeDefinition[] for discovered custom themes; CSS cache for active loader.
 */

import type { ThemeDefinition } from './theme-registry';

const MAX_THEME_CSS_SIZE = 512 * 1024; // 512KB

// Cache: custom theme id -> raw CSS (sanitized happens at inject time, not here).
// Populated by discoverCustomThemes(); consumed by loadTheme() and injectCustomThemeCSS().
const customCSSById = new Map<string, string>();

const README_TEMPLATE = `# Binderus Custom Themes

Drop \`.css\` theme files in this folder. They appear in
Settings → Appearance → Theme under the "Custom" group.

Each file must start with a /* @theme */ metadata block:

    /* @theme
    id: my-theme
    name: My Theme
    variant: dark
    accent: "#88c0d0"
    description: One-line description shown in the picker
    */

    [data-theme="my-theme"] {
      --bg-primary: #1e1e1e;
      /* ... only the variables you want to override ... */
    }

Required fields: id, name, variant (dark | light).
Hex values must be quoted ("#88c0d0"); bare hex tokens fail to parse.

Click "Refresh" in Settings after editing files in this folder.
`;

/**
 * Sanitize user-provided CSS to prevent data exfiltration and security issues.
 * Two pre-passes (decode unicode escapes, strip comments) close the \\u-escape and
 * /*evasion*​/ classes that the deny-list alone would miss.
 *
 * Order invariant: parseThemeMeta() must run on the RAW source BEFORE this function
 * strips comments — otherwise the /* @theme *​/ block is erased.
 */
export function sanitizeThemeCSS(css: string): string {
  // 1. Decode CSS unicode escapes so `\40 import` becomes `@import` before matching.
  css = css.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => {
    const code = parseInt(hex, 16);
    // Keep printable ASCII range only; drop control chars / above-BMP weirdness.
    return code >= 0x20 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
  // 2. Strip CSS comments so `@imp/**/ort` becomes `@import` before matching.
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // 3. Deny-list pass.
  return css
    .replace(/@import\s+[^;]+;?/gi, '')
    .replace(/@(?:namespace|charset|document)\s+[^;{]*[;{]?/gi, '')
    .replace(/@font-face\s*\{[^}]*\}/gi, '')
    .replace(/(?:url|image-set|cross-fade|paint|-webkit-image-set)\s*\([^)]*\)/gi, 'none')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/-moz-binding\s*:[^;]+;?/gi, '')
    .replace(/behavior\s*:[^;]+;?/gi, '');
}

/**
 * Parse the /* @theme *​/ metadata block from a CSS theme file.
 * Returns null if the metadata block is missing or malformed.
 *
 * Hand-rolled line parser — see plan §1 for why we don't pull in a YAML lib.
 */
export function parseThemeMeta(cssText: string): Omit<ThemeDefinition, 'source' | 'filePath'> | null {
  // Strip BOM before the regex match — UTF-8 BOM at file head silently invalidates `^/*`.
  const stripped = cssText.replace(/^﻿/, '');
  const match = stripped.match(/\/\*\s*@theme\s*\n([\s\S]*?)\*\//);
  if (!match) return null;

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip surrounding double quotes — canonical form for hex values is `accent: "#88c0d0"`.
    value = value.replace(/^"(.*)"$/, '$1');
    // Strip end-of-line `# comment` (unquoted only — quoted values keep `#` since they're handled above).
    value = value.replace(/\s+#.*$/, '');
    if (!key || !value) continue;
    fields[key] = value;
  }

  if (!fields.name || !fields.id || !fields.variant) return null;
  if (fields.variant !== 'dark' && fields.variant !== 'light') return null;

  // Optional `/* @settings ... */` block — reserved for v1.5 Style-Settings-equivalent
  // author knobs. v1 captures the raw block so it round-trips through export untouched.
  const settingsMatch = stripped.match(/\/\*\s*@settings\s*\n[\s\S]*?\*\//);

  return {
    id: fields.id,
    name: fields.name,
    variant: fields.variant as 'dark' | 'light',
    accentColor: fields.accent || '#888888',
    author: fields.author,
    description: fields.description,
    extends: fields.extends,
    settingsBlock: settingsMatch ? settingsMatch[0] : undefined,
  };
}

/**
 * Merge a child custom theme with its declared `extends:` parent (built-in only in v1).
 * Returns the merged CSS — parent rules first, child overrides after. The parent's
 * `[data-theme="<parent-id>"]` selector is rewritten to target the child id so a single
 * `data-theme` attribute carries both rule sets.
 *
 * If the child has no `extends` field, returns the child CSS unchanged.
 * If the parent is unknown (uninstalled or non-built-in), warns and returns child only.
 */
export function mergeWithParent(
  childId: string,
  childCSS: string,
  resolveParent: (parentId: string) => string | undefined
): string {
  const meta = parseThemeMeta(childCSS);
  if (!meta?.extends) return childCSS;

  const parentCSS = resolveParent(meta.extends);
  if (!parentCSS) {
    // Unknown parent — log and fall through so the child still loads (gracefully degraded).
    // eslint-disable-next-line no-console
    console.warn(`[themes] Custom theme "${childId}" extends "${meta.extends}" but parent was not found.`);
    return childCSS;
  }

  // Strip parent's metadata block — only its rules contribute to the cascade.
  const parentBody = parentCSS.replace(/\/\*\s*@theme\s*\n[\s\S]*?\*\/\s*/, '');
  // Rewrite the parent's selector to target the child so a single data-theme attribute applies both.
  const escapedParent = meta.extends.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rewrittenParent = parentBody.replace(
    new RegExp(`\\[data-theme="${escapedParent}"\\]`, 'g'),
    `[data-theme="${childId}"]`
  );

  return `${rewrittenParent}\n${childCSS}`;
}

/**
 * Inject a custom theme's CSS into the DOM as a <style> element.
 */
export function injectCustomThemeCSS(themeId: string, cssText: string): void {
  document.querySelector(`style[data-theme-id="${themeId}"]`)?.remove();
  const style = document.createElement('style');
  style.setAttribute('data-theme-id', themeId);
  style.textContent = sanitizeThemeCSS(cssText);
  document.head.appendChild(style);
}

/**
 * Look up cached CSS for a custom theme by id. Used by theme-registry.loadTheme().
 */
export function getCustomThemeCSS(id: string): string | undefined {
  return customCSSById.get(id);
}

export function clearCustomThemeCache(): void {
  customCSSById.clear();
}

/**
 * Discover custom themes from the $APPDATA/themes/ directory. Caches raw CSS so
 * loadTheme() can inject without a second FS round-trip. Tauri-only; web/dev returns [].
 */
export async function discoverCustomThemes(): Promise<ThemeDefinition[]> {
  try {
    const { readTextFile, readDir, exists, mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const { appDataDir, join } = await import('@tauri-apps/api/path');

    const dataDir = await appDataDir();
    const themesDir = await join(dataDir, 'themes');

    if (!(await exists(themesDir))) {
      await mkdir(themesDir, { recursive: true });
      // Seed README on first run so the user knows what to do with the folder.
      const readmePath = await join(themesDir, 'README.md');
      try {
        await writeTextFile(readmePath, README_TEMPLATE);
      } catch {
        // Non-fatal — the folder exists, that's the important part.
      }
      return [];
    }

    const entries = await readDir(themesDir);
    const themes: ThemeDefinition[] = [];

    // Reset cache before re-discovering so deleted files don't linger.
    customCSSById.clear();

    for (const entry of entries) {
      if (!entry.name?.endsWith('.css')) continue;

      try {
        const filePath = await join(themesDir, entry.name);
        const cssText = await readTextFile(filePath);

        if (cssText.length > MAX_THEME_CSS_SIZE) continue;

        const meta = parseThemeMeta(cssText);
        if (!meta) continue;

        customCSSById.set(meta.id, cssText);
        themes.push({
          ...meta,
          source: 'custom',
          filePath,
        });
      } catch {
        // Skip invalid files silently — surface in management UI later (Phase D).
      }
    }

    return themes;
  } catch {
    return []; // Not in Tauri or themes/ doesn't exist
  }
}

/**
 * Build a starter `.css` from an existing theme — replaces the metadata block,
 * rewrites the `[data-theme="<id>"]` selector, and prepends a generated-by header.
 * Caller supplies the source CSS (look up via theme-registry.getThemeSourceCSS).
 */
export function buildStarterFromTheme(args: {
  sourceCSS: string;
  oldId: string;
  oldName: string;
  newId: string;
  newName: string;
  variant: 'dark' | 'light';
  accent: string;
  appVersion: string;
}): string {
  const { sourceCSS, oldId, newId, newName, variant, accent, appVersion } = args;

  // Replace the existing /* @theme */ block with a fresh one (or prepend if missing).
  const metaBlock =
    `/* @theme\n` +
    `id: ${newId}\n` +
    `name: ${newName}\n` +
    `variant: ${variant}\n` +
    `accent: "${accent}"\n` +
    `description: Starter copied from ${args.oldName}\n` +
    `*/\n`;

  let body = sourceCSS;
  const existingMeta = body.match(/\/\*\s*@theme\s*\n[\s\S]*?\*\/\s*/);
  body = existingMeta ? body.replace(existingMeta[0], '') : body;
  // The `/* @settings ... */` block (if any) stays inside `body` and round-trips verbatim.

  // Rewrite the selector — escape regex metacharacters in the old id.
  const escapedOldId = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  body = body.replace(new RegExp(`\\[data-theme="${escapedOldId}"\\]`, 'g'), `[data-theme="${newId}"]`);

  const header = `/* Generated against Binderus ${appVersion}. Edit freely — see docs/topics/theme.md for the full variable list. */\n\n`;
  return metaBlock + '\n' + header + body.trimStart();
}

/**
 * Save a starter `.css` to a user-chosen location. Defaults to $APPDATA/themes/<newId>.css.
 * Returns the absolute path saved to, or null if the user cancelled.
 */
export async function saveStarterToDisk(newId: string, content: string): Promise<string | null> {
  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const { appDataDir, join } = await import('@tauri-apps/api/path');
    const { save: saveDialog } = await import('@tauri-apps/plugin-dialog');

    const dataDir = await appDataDir();
    const themesDir = await join(dataDir, 'themes');
    const defaultPath = await join(themesDir, `${newId}.css`);

    const chosen = await saveDialog({
      defaultPath,
      filters: [{ name: 'CSS', extensions: ['css'] }],
    });
    if (!chosen) return null;
    await writeTextFile(chosen, content);
    return chosen;
  } catch {
    return null;
  }
}

/** Slug regex used for theme ids. Matches the install-time validator. */
const ID_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const MAX_INSTALL_BYTES = 512 * 1024;

export type InstallResult =
  | { ok: true; id: string; path: string; overwrote: boolean }
  | { ok: false; reason: string };

/**
 * Install a theme `.css` file from an arbitrary location into `$APPDATA/themes/<id>.css`.
 * Validates metadata, slug-safety, size, and presence of theme content before copying.
 *
 * If a theme with the same id already exists, the caller decides via `overwriteIfExists`.
 */
export async function installThemeFromFile(args: {
  sourcePath: string;
  overwriteIfExists: boolean;
}): Promise<InstallResult> {
  try {
    const { readTextFile, writeTextFile, exists, mkdir, stat } = await import('@tauri-apps/plugin-fs');
    const { appDataDir, join } = await import('@tauri-apps/api/path');

    // Size pre-check via stat (avoids reading huge files into memory).
    try {
      const s = await stat(args.sourcePath);
      if (typeof s.size === 'number' && s.size > MAX_INSTALL_BYTES) {
        return { ok: false, reason: 'too_large' };
      }
    } catch { /* stat failures fall through to readTextFile */ }

    const cssText = await readTextFile(args.sourcePath);
    if (cssText.length > MAX_INSTALL_BYTES) return { ok: false, reason: 'too_large' };

    const meta = parseThemeMeta(cssText);
    if (!meta) return { ok: false, reason: 'no_metadata' };
    if (!ID_SLUG_RE.test(meta.id)) return { ok: false, reason: 'bad_id' };

    const dataDir = await appDataDir();
    const themesDir = await join(dataDir, 'themes');
    if (!(await exists(themesDir))) await mkdir(themesDir, { recursive: true });

    const target = await join(themesDir, `${meta.id}.css`);
    const targetExists = await exists(target);
    if (targetExists && !args.overwriteIfExists) return { ok: false, reason: 'exists' };

    await writeTextFile(target, cssText);
    return { ok: true, id: meta.id, path: target, overwrote: targetExists };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'unknown' };
  }
}

/**
 * Delete a custom theme's `.css` file from disk. Caller is responsible for
 * unregistering the theme from the registry and falling back if it was active.
 */
export async function uninstallThemeFile(filePath: string): Promise<boolean> {
  try {
    const { remove } = await import('@tauri-apps/plugin-fs');
    await remove(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reveal a custom theme's source file in the OS file manager.
 */
export async function revealThemeFile(filePath: string): Promise<void> {
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(filePath);
  } catch {
    // Best-effort.
  }
}

/**
 * Inject (or remove) a `:root` block that overrides the theme's accent HSL components.
 * The override wins because it's appended AFTER the active-theme style, so equal-specificity
 * rules later in the document win the cascade.
 *
 * Pass `null` to clear the override.
 */
export function applyAccentOverride(override: { h: number; s: number; l: number } | null): void {
  const ATTR = 'data-binderus-accent-override';
  const existing = document.head.querySelector<HTMLStyleElement>(`style[${ATTR}]`);
  if (!override) {
    existing?.remove();
    return;
  }
  const css = `:root { --accent-h: ${override.h}; --accent-s: ${override.s}%; --accent-l: ${override.l}%; }`;
  if (existing) {
    existing.textContent = css;
  } else {
    const el = document.createElement('style');
    el.setAttribute(ATTR, '');
    el.textContent = css;
    document.head.appendChild(el);
  }
}

/**
 * Hex to HSL. Returns null on invalid input. Output components are 0–360 / 0–100 / 0–100.
 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const clean = hex.trim().replace(/^#/, '');
  if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(clean)) return null;
  const expand = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(expand.slice(0, 2), 16) / 255;
  const g = parseInt(expand.slice(2, 4), 16) / 255;
  const b = parseInt(expand.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = ((b - r) / d + 2);
    else h = ((r - g) / d + 4);
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * Inject (or remove) a `:root` block that overrides the active theme's code-block
 * Prism palette (`--prism-bg`, `--prism-fg`). Lets a user pair a light UI with a
 * dark code-block theme (or vice versa) without forking the theme.
 *
 * Pass `null` to clear the override.
 */
export function applyCodeThemeOverride(colors: { bg: string; fg: string } | null): void {
  const ATTR = 'data-binderus-code-override';
  const existing = document.head.querySelector<HTMLStyleElement>(`style[${ATTR}]`);
  if (!colors) {
    existing?.remove();
    return;
  }
  const css = `:root { --prism-bg: ${colors.bg}; --prism-fg: ${colors.fg}; }`;
  if (existing) {
    existing.textContent = css;
  } else {
    const el = document.createElement('style');
    el.setAttribute(ATTR, '');
    el.textContent = css;
    document.head.appendChild(el);
  }
}

/**
 * Extract `--prism-bg` and `--prism-fg` from a theme's source CSS by regex.
 * Returns null if either is missing — caller falls back to the active UI theme.
 *
 * Cheap and sufficient because Binderus theme files set both vars literally,
 * never via `var(...)` indirection or computed values.
 */
export function extractPrismColors(sourceCSS: string): { bg: string; fg: string } | null {
  const bg = sourceCSS.match(/--prism-bg\s*:\s*([^;}\n]+)/);
  const fg = sourceCSS.match(/--prism-fg\s*:\s*([^;}\n]+)/);
  if (!bg || !fg) return null;
  return { bg: bg[1].trim(), fg: fg[1].trim() };
}

/**
 * HSL to hex. Components: 0–360 / 0–100 / 0–100.
 */
export function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/**
 * Open the themes folder in the OS file manager.
 */
export async function openThemesFolder(): Promise<void> {
  try {
    const { exists, mkdir } = await import('@tauri-apps/plugin-fs');
    const { appDataDir, join } = await import('@tauri-apps/api/path');
    const { open: shellOpen } = await import('@tauri-apps/plugin-shell');

    const dataDir = await appDataDir();
    const themesDir = await join(dataDir, 'themes');
    if (!(await exists(themesDir))) {
      await mkdir(themesDir, { recursive: true });
    }
    await shellOpen(themesDir);
  } catch {
    // Best-effort.
  }
}
