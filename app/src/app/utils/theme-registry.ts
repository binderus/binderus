/**
 * Description: Theme registry for Binderus. Defines built-in theme metadata,
 *   provides helpers for theme lookup, and handles lazy-loading theme CSS with cleanup.
 * Requirements: Vite for dynamic CSS imports with ?inline suffix
 * Inputs: Theme ID string
 * Outputs: Theme metadata, isDarkTheme check, loadTheme function
 */

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
}

export const BUILTIN_THEMES: ThemeDefinition[] = [
  { id: 'dark-nord', name: 'Nord Dark', variant: 'dark', accentColor: '#88c0d0', source: 'builtin', description: 'Arctic, north-bluish palette' },
  { id: 'light-white', name: 'Classic Light', variant: 'light', accentColor: '#2563eb', source: 'builtin', description: 'Clean, minimal light theme' },
  { id: 'dark-dracula', name: 'Dracula', variant: 'dark', accentColor: '#bd93f9', source: 'builtin', description: 'Dark theme with vivid colors' },
  { id: 'dark-one-dark', name: 'One Dark Pro', variant: 'dark', accentColor: '#61afef', source: 'builtin', description: 'Atom One Dark inspired' },
  { id: 'dark-catppuccin', name: 'Catppuccin Mocha', variant: 'dark', accentColor: '#cba6f7', source: 'builtin', description: 'Soothing pastel dark theme' },
  { id: 'light-catppuccin', name: 'Catppuccin Latte', variant: 'light', accentColor: '#8839ef', source: 'builtin', description: 'Warm pastel light theme' },
  { id: 'dark-github', name: 'GitHub Dark', variant: 'dark', accentColor: '#58a6ff', source: 'builtin', description: 'GitHub\'s official dark theme' },
  { id: 'dark-solarized', name: 'Solarized Dark', variant: 'dark', accentColor: '#268bd2', source: 'builtin', description: 'Scientifically designed color scheme' },
  { id: 'dark-gruvbox', name: 'Gruvbox Dark', variant: 'dark', accentColor: '#fabd2f', source: 'builtin', description: 'Retro groove warm dark theme' },
  { id: 'dark-tokyo-night', name: 'Tokyo Night', variant: 'dark', accentColor: '#7aa2f7', source: 'builtin', description: 'Inspired by Tokyo city lights' },
];

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

// --- Theme CSS Loading ---

// Map of theme id -> loaded CSS module (for built-in themes)
const loadedCSS = new Map<string, string>();
let currentThemeStyleEl: HTMLStyleElement | null = null;

const themeImporters: Record<string, () => Promise<{ default: string }>> = {
  'dark-nord': () => import('../../themes/dark-nord.css?inline'),
  'light-white': () => import('../../themes/light-white.css?inline'),
  'dark-dracula': () => import('../../themes/dark-dracula.css?inline'),
  'dark-one-dark': () => import('../../themes/dark-one-dark.css?inline'),
  'dark-catppuccin': () => import('../../themes/dark-catppuccin.css?inline'),
  'light-catppuccin': () => import('../../themes/light-catppuccin.css?inline'),
  'dark-github': () => import('../../themes/dark-github.css?inline'),
  'dark-solarized': () => import('../../themes/dark-solarized.css?inline'),
  'dark-gruvbox': () => import('../../themes/dark-gruvbox.css?inline'),
  'dark-tokyo-night': () => import('../../themes/dark-tokyo-night.css?inline'),
};

export async function loadTheme(themeId: string): Promise<void> {
  // Remove previous built-in theme style to avoid CSS accumulation
  currentThemeStyleEl?.remove();
  currentThemeStyleEl = null;

  // Also remove any custom theme style that might be active
  document.querySelectorAll('style[data-theme-id]').forEach((el) => el.remove());

  const importer = themeImporters[themeId];
  if (importer) {
    // Built-in theme: use cached or load
    let css = loadedCSS.get(themeId);
    if (!css) {
      const module = await importer();
      css = module.default;
      loadedCSS.set(themeId, css);
    }
    const style = document.createElement('style');
    style.setAttribute('data-theme-id', themeId);
    style.textContent = css;
    document.head.appendChild(style);
    currentThemeStyleEl = style;
  }
  // For custom themes, CSS is injected by theme-loader.ts

  document.documentElement.setAttribute('data-theme', themeId);
}
