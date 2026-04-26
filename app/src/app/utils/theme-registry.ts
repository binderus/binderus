/**
 * Description: Theme registry for Binderus. Discovers built-in themes from
 *   src/themes/*.css at build time via Vite's import.meta.glob, parses their
 *   /* @theme *​/ metadata block, and provides a single loader for both built-in
 *   and custom themes.
 * Requirements: Vite (import.meta.glob), parseThemeMeta from theme-loader.ts
 * Inputs: Theme ID string
 * Outputs: Theme metadata, isDarkTheme check, loadTheme/registerThemes/unregisterTheme
 */

import { parseThemeMeta, getCustomThemeCSS, sanitizeThemeCSS, mergeWithParent } from './theme-loader';

export interface ThemeDefinition {
  id: string;
  name: string;
  variant: 'dark' | 'light';
  accentColor: string;
  author?: string;
  description?: string;
  source: 'builtin' | 'custom' | 'gallery';
  filePath?: string;
  version?: string;
  // Built-in theme id this custom theme inherits from. Restricted to built-ins in v1.
  extends?: string;
  // Reserved for v1.5 author-exposed knobs (Style-Settings-equivalent). v1 captures
  // the raw `/* @settings ... */` block as opaque text so future versions can parse
  // it without breaking themes authored against the v1 spec.
  settingsBlock?: string;
}

// Eager-load all built-in theme CSS at build time. Each file must start with a
// /* @theme */ metadata block; missing blocks throw at module-init so CI catches it.
//
// IMPORTANT: use `?raw`, NOT `?inline`. `?inline` runs the file through Vite's CSS
// pipeline which minifies and strips comments — the `/* @theme */` block disappears
// in production builds, breaking parseThemeMeta. `?raw` returns the file byte-for-byte.
const builtinModules = import.meta.glob('../../themes/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Skip the shared variable-contract file — it has no metadata block.
const builtinCSS: Record<string, string> = {};
for (const [path, css] of Object.entries(builtinModules)) {
  if (path.endsWith('/_variables.css')) continue;
  builtinCSS[path] = css;
}

export const BUILTIN_THEMES: ThemeDefinition[] = Object.entries(builtinCSS).map(([path, css]) => {
  const meta = parseThemeMeta(css);
  if (!meta) {
    throw new Error(`Built-in theme is missing or has malformed /* @theme */ metadata block: ${path}`);
  }
  return { ...meta, source: 'builtin' };
});

// id -> raw CSS string lookup, used by loadTheme() for built-ins.
const builtinCSSById: Record<string, string> = {};
for (const [path, css] of Object.entries(builtinCSS)) {
  const meta = parseThemeMeta(css);
  if (meta) builtinCSSById[meta.id] = css;
}

/**
 * Look up raw CSS for any theme id (built-in or custom). Used by export/duplicate flows.
 */
export function getThemeSourceCSS(id: string): string | undefined {
  return builtinCSSById[id] ?? getCustomThemeCSS(id);
}

/**
 * Look up raw CSS for a built-in theme id only. Used by `extends:` merge —
 * v1 restricts inheritance to built-in parents to avoid dependency chains.
 */
export function getBuiltinSourceCSS(id: string): string | undefined {
  return builtinCSSById[id];
}

// Mutable registry — custom/gallery themes are merged in at runtime
let registeredThemes: ThemeDefinition[] = [...BUILTIN_THEMES];

export function getTheme(id: string): ThemeDefinition | undefined {
  return registeredThemes.find((t) => t.id === id);
}

export function isDarkTheme(id: string): boolean {
  const theme = getTheme(id);
  return theme ? theme.variant === 'dark' : true; // default dark if unknown
}

export function getThemesByVariant(variant: 'dark' | 'light'): ThemeDefinition[] {
  return registeredThemes.filter((t) => t.variant === variant);
}

export function getAllThemes(): ThemeDefinition[] {
  return registeredThemes;
}

export function registerThemes(themes: ThemeDefinition[]): void {
  // Add custom themes, avoiding duplicates by id
  for (const t of themes) {
    const idx = registeredThemes.findIndex((r) => r.id === t.id);
    if (idx >= 0) {
      registeredThemes[idx] = t;
    } else {
      registeredThemes.push(t);
    }
  }
}

export function unregisterTheme(id: string): void {
  const idx = registeredThemes.findIndex((r) => r.id === id);
  if (idx < 0) return;
  // Refuse to remove built-ins — they are bundled with the app.
  if (registeredThemes[idx].source === 'builtin') return;
  registeredThemes.splice(idx, 1);
}

// --- Theme CSS Loading ---

const ACTIVE_STYLE_MARKER = 'data-binderus-active-theme';

export async function loadTheme(themeId: string): Promise<void> {
  // Resolve CSS: built-in first (un-sanitized, trusted), then custom (sanitized).
  // Custom themes that declare `extends:` are merged with their built-in parent so
  // a single injected block carries both rule sets (approach C from plan §4).
  let css: string | undefined = builtinCSSById[themeId];
  let trusted = true;
  if (!css) {
    const rawCustom = getCustomThemeCSS(themeId);
    if (rawCustom) {
      const merged = mergeWithParent(themeId, rawCustom, getBuiltinSourceCSS);
      css = sanitizeThemeCSS(merged);
      trusted = false;
    }
  }

  // Defence in depth: drop any leftover `style[data-theme-id]` elements that aren't
  // our managed active style. HMR, prior code paths, or stale custom-theme injections
  // can leave these behind and they win the cascade by appending-last order.
  document.querySelectorAll('style[data-theme-id]').forEach((el) => {
    if (!el.hasAttribute(ACTIVE_STYLE_MARKER)) el.remove();
  });

  // Reuse a single <style> element across theme switches and mutate textContent —
  // avoids CSSOM churn / brief flash of unstyled content. (Phase A.5.3)
  // CRITICAL: re-append the element so it's last in <head> and wins the cascade
  // against `_variables.css` (statically imported, has `:root` defaults) and
  // anything else with equal-specificity selectors loaded earlier.
  let active = document.head.querySelector<HTMLStyleElement>(`style[${ACTIVE_STYLE_MARKER}]`);
  if (css) {
    if (!active) {
      active = document.createElement('style');
      active.setAttribute(ACTIVE_STYLE_MARKER, '');
    }
    active.setAttribute('data-theme-id', themeId);
    active.setAttribute('data-theme-trust', trusted ? 'builtin' : 'custom');
    active.textContent = css;
    // Always (re-)append last so cascade order is correct.
    document.head.appendChild(active);
  } else if (active) {
    // Unknown theme id — clear the active style rather than leave stale CSS in place.
    active.textContent = '';
    active.setAttribute('data-theme-id', '');
  }

  document.documentElement.setAttribute('data-theme', themeId);
}
