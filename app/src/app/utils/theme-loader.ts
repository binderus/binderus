/**
 * Description: Custom theme filesystem loader for Binderus. Discovers user CSS theme
 *   files in $APPDATA/themes/, parses metadata, sanitizes CSS, and injects into DOM.
 * Requirements: @tauri-apps/plugin-fs, @tauri-apps/api/path
 * Inputs: CSS files from $APPDATA/themes/
 * Outputs: ThemeDefinition[] for discovered custom themes
 */

import { ThemeDefinition } from './theme-registry';

const MAX_THEME_CSS_SIZE = 512 * 1024; // 512KB

/**
 * Sanitize user-provided CSS to prevent data exfiltration and security issues.
 * Strips @import, url(), expression(), -moz-binding directives.
 */
export function sanitizeThemeCSS(css: string): string {
  return css
    .replace(/@import\s+[^;]+;/gi, '')
    .replace(/url\s*\([^)]*\)/gi, 'url()')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/-moz-binding\s*:[^;]+;/gi, '');
}

/**
 * Parse the /* @theme *​/ YAML metadata block from a CSS theme file.
 * Returns null if the metadata block is missing or malformed.
 */
export function parseThemeMeta(cssText: string): Omit<ThemeDefinition, 'source' | 'filePath'> | null {
  const match = cssText.match(/\/\*\s*@theme\s*\n([\s\S]*?)\*\//);
  if (!match) return null;

  const yaml = match[1];
  const fields: Record<string, string> = {};
  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key && value) fields[key] = value;
    }
  }

  if (!fields.name || !fields.id || !fields.variant) return null;
  if (fields.variant !== 'dark' && fields.variant !== 'light') return null;

  return {
    id: fields.id,
    name: fields.name,
    variant: fields.variant as 'dark' | 'light',
    accentColor: fields.accent || '#888888',
    author: fields.author,
    description: fields.description,
  };
}

/**
 * Inject a custom theme's CSS into the DOM as a <style> element.
 */
export function injectCustomThemeCSS(themeId: string, cssText: string): void {
  // Remove any existing style for this theme
  document.querySelector(`style[data-theme-id="${themeId}"]`)?.remove();

  const sanitized = sanitizeThemeCSS(cssText);
  const style = document.createElement('style');
  style.setAttribute('data-theme-id', themeId);
  style.textContent = sanitized;
  document.head.appendChild(style);
}

/**
 * Discover custom themes from the $APPDATA/themes/ directory.
 * Returns an array of ThemeDefinition for all valid theme files found.
 *
 * Note: This function requires Tauri runtime. It is a no-op in web/dev mode.
 */
export async function discoverCustomThemes(): Promise<ThemeDefinition[]> {
  try {
    // Dynamic import to avoid breaking web dev mode
    const { readTextFile, readDir, exists, mkdir } = await import('@tauri-apps/plugin-fs');
    const { appDataDir } = await import('@tauri-apps/api/path');

    const dataDir = await appDataDir();
    const themesDir = `${dataDir}/themes`;

    // Create themes directory if it doesn't exist
    const dirExists = await exists(themesDir);
    if (!dirExists) {
      await mkdir(themesDir, { recursive: true });
      return [];
    }

    const entries = await readDir(themesDir);
    const themes: ThemeDefinition[] = [];

    for (const entry of entries) {
      if (!entry.name?.endsWith('.css')) continue;

      try {
        const filePath = `${themesDir}/${entry.name}`;
        const cssText = await readTextFile(filePath);

        // Size check
        if (cssText.length > MAX_THEME_CSS_SIZE) continue;

        const meta = parseThemeMeta(cssText);
        if (!meta) continue;

        themes.push({
          ...meta,
          source: 'custom',
          filePath,
        });
      } catch {
        // Skip invalid files silently
      }
    }

    return themes;
  } catch {
    return []; // Not in Tauri or themes/ doesn't exist
  }
}
