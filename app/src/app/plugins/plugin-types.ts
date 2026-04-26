/**
 * Description: Types for the Tier-1 plugin system. Plugins are trusted
 *   in-process modules that activate once at app startup. This version
 *   adds two backward-compatible contribution surfaces on top of the MVP:
 *     - ctx.panel       — right-side slide-out panels (like the Raw MD panel)
 *     - ctx.settings    — plugin-scoped persisted settings (stored under
 *                         `plugins.<id>` inside the vault settings JSON)
 *     - ctx.commands    — Quick Switcher command registration
 *
 *   All new surfaces follow the same auto-scoping rule as the status bar:
 *   plugin authors pass short ids, the host namespaces with `plugin:<id>`
 *   for bulk teardown on deactivate.
 * Inputs: imported by plugin-manager and each plugin file.
 * Outputs: AppPlugin / PluginContext type definitions.
 */

import type { ReactNode } from 'react';
import type { StatusBarItemDescriptor } from '../components/status-bar/status-bar-registry';

export interface PluginStatusBarItem extends Omit<StatusBarItemDescriptor, 'source'> {}

export interface ActiveDocument {
  path: string | null;
  content: string;
}

export interface PluginLocaleBundle {
  [locale: string]: Record<string, string>;
}

// ---------- Status bar ---------- (unchanged from MVP)
export interface StatusBarItemHandle {
  set(partial: Partial<Omit<PluginStatusBarItem, 'id'>>): void;
  show(): void;
  hide(): void;
  dispose(): void;
}

// ---------- Panels (NEW) ----------

export interface PluginPanelDescriptor {
  /** Short id, unprefixed. Host will scope to `plugin:<id>:<panelId>`. */
  id: string;
  /** Human-visible title shown in the panel header. */
  title: string;
  /** React renderer. Receives a `close` callback. Pure function of plugin state. */
  render: (ctx: PluginPanelRenderContext) => ReactNode;
  /** Panel width as a viewport percentage. Default: 40. */
  widthPct?: number;
  /** Which side of the screen. Default: 'right'. */
  side?: 'right' | 'left';
  /**
   * If true, the host registers a Quick-Switcher command "Toggle <title>"
   * so users can open/close via Cmd+P. Default: true.
   */
  registerCommand?: boolean;
}

export interface PluginPanelRenderContext {
  /** Close this panel (equivalent to calling handle.hide()). */
  close: () => void;
}

export interface PanelHandle {
  /** Toggle visibility. */
  toggle(): void;
  /** Show the panel (no-op if already visible). */
  show(): void;
  /** Hide the panel without disposing. */
  hide(): void;
  /** Current visibility. */
  isVisible(): boolean;
  /** Permanently remove the panel from the registry. */
  dispose(): void;
}

// ---------- Settings (NEW) ----------

export interface PluginSettingsApi<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Read the full settings object (synchronous — cached in memory after load). */
  get(): T;
  /** Merge-update settings. Fires onChange listeners. Persists to vault JSON asynchronously. */
  set(partial: Partial<T>): void;
  /** Replace the whole settings object (rare; use `set` for partial updates). */
  replace(next: T): void;
  /** Subscribe to changes. Returns unsubscribe. */
  onChange(cb: (settings: T) => void): () => void;
}

// ---------- Commands (NEW) ----------

export interface PluginCommandDescriptor {
  id: string;
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  shortcut?: string;
}

export interface PluginCommandsApi {
  register(cmd: PluginCommandDescriptor): () => void;
}

// ---------- Shortcuts (NEW) ----------

export interface PluginShortcutsApi {
  /**
   * Register a global keyboard shortcut. Combo syntax:
   *   "Cmd+L", "Cmd+Shift+K", "Alt+/", "Ctrl+Space".
   * "Cmd" = platform-primary modifier (meta on macOS, ctrl elsewhere);
   * "Ctrl" is always raw ctrl. Plugin shortcuts take precedence over
   * built-in app shortcuts with the same combo. Returns a disposer.
   */
  register(combo: string, callback: () => void): () => void;
}

// ---------- Context ----------

export interface PluginContext {
  readonly id: string;
  readonly statusBar: {
    create(item: PluginStatusBarItem): StatusBarItemHandle;
  };
  readonly panel: {
    /**
     * Register a slide-out panel. Returns a handle for toggle/show/hide/dispose.
     * If `registerCommand` is true (default), a Cmd+P entry is auto-registered.
     */
    register(panel: PluginPanelDescriptor): PanelHandle;
    /** Look up an existing panel by its unscoped id. */
    find(unscopedId: string): PanelHandle | undefined;
  };
  readonly settings: PluginSettingsApi;
  readonly commands: PluginCommandsApi;
  readonly shortcuts: PluginShortcutsApi;
  readonly editor: {
    getActiveDocument(): ActiveDocument;
    onDocumentChange(cb: (doc: ActiveDocument) => void): () => void;
  };
  /**
   * Resolve a translation key.
   *   1. Plugin's own bundle for the current locale
   *   2. Plugin's en-US bundle (fallback)
   *   3. Host's intl bundle (lets plugins reuse host keys like STATUS_WORDS)
   *   4. Literal key (so a missing key is visible during development)
   */
  readonly t: (key: string, vars?: Record<string, unknown>) => string;
  readonly onLocaleChange: (cb: (locale: string) => void) => () => void;
  readonly log: (...args: unknown[]) => void;
}

/**
 * AppPlugin — either built-in (bundled in-app) or a user plugin (lives
 * under src/app/plugins/user/<id>/). Both are Tier-1 trusted today.
 */
export interface AppPlugin {
  readonly id: string;
  readonly version: string;
  readonly name?: string;
  readonly description?: string;
  readonly locales?: PluginLocaleBundle;
  /** Where this plugin lives in the codebase. Drives filtering in the Manage Plugins modal. */
  readonly category?: 'built-in' | 'user';
  activate(ctx: PluginContext): void | (() => void);
}
