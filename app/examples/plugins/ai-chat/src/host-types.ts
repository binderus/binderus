/**
 * Description: TypeScript mirror of the Binderus plugin contract.
 *   Re-declares the subset this plugin depends on so the bundle has no
 *   runtime dependency on the host.
 *
 *   If the host contract changes, update this file to match — the
 *   types are erased at build time, so there is no runtime coupling.
 *
 * Inputs: none — pure type declarations.
 * Outputs: `AppPlugin`, `PluginContext`, `PanelHandle`, and the handful
 *   of supporting types the AI Chat plugin touches.
 */

export type PluginScopedId = string;

export interface PluginPanelDescriptor {
  id: string;
  title: string;
  side?: 'left' | 'right';
  widthPct?: number;
  registerCommand?: boolean;
  /**
   * The host passes `{ close }` so the plugin can request the panel be
   * hidden from inside its own UI (e.g., a ✕ button in the header).
   */
  render: (args: { close: () => void }) => unknown;
}

export interface PanelHandle {
  readonly scopedId: PluginScopedId;
  show(): void;
  hide(): void;
  toggle(): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export interface PluginCommandDescriptor {
  id: string;
  label: string;
  icon?: unknown;
  shortcut?: string;
  onSelect: () => void;
}

export interface CommandHandle {
  readonly scopedId: PluginScopedId;
  dispose(): void;
}

export interface PluginSettingsApi<TSettings = unknown> {
  get(): Partial<TSettings>;
  set(next: TSettings | Partial<TSettings>): void;
  onChange(cb: (next: TSettings) => void): () => void;
}

export interface StatusBarHandle {
  setText(text: string): void;
  setTitle(title: string): void;
  dispose(): void;
}

export interface ActiveDocument {
  path: string | null;
  content: string;
  selection?: { from: number; to: number; text: string } | null;
}

export interface PluginContext {
  readonly pluginId: string;
  t(key: string, fallback?: string): string;
  onLocaleChange(cb: () => void): () => void;
  log(...args: unknown[]): void;

  panel: {
    register(desc: PluginPanelDescriptor): PanelHandle;
    toggle(scopedId: PluginScopedId): void;
  };

  commands: {
    register(desc: PluginCommandDescriptor): CommandHandle;
  };

  /**
   * Global keyboard shortcuts. Combo syntax: "Cmd+L", "Cmd+Shift+K",
   * "Alt+/". "Cmd" maps to meta on macOS, ctrl elsewhere. Plugin
   * shortcuts take precedence over built-in app shortcuts.
   */
  shortcuts: {
    register(combo: string, callback: () => void): () => void;
  };

  settings: PluginSettingsApi<unknown>;

  editor: {
    getActiveDocument(): ActiveDocument | null;
    onDocumentChange(cb: (doc: ActiveDocument | null) => void): () => void;
  };

  statusBar: {
    create(opts: { id: string; text: string; title?: string }): StatusBarHandle;
  };
}

export interface AppPlugin {
  readonly id: string;
  readonly version: string;
  readonly name?: string;
  readonly description?: string;
  readonly locales?: Record<string, Record<string, string>>;
  readonly category?: 'built-in' | 'user';
  activate(ctx: PluginContext): void | (() => void);
}

/**
 * Shape of the runtime API the host injects via
 * `globalThis.__BINDERUS_PLUGIN_API__`. Exposed so plugin factories
 * receive a typed `api` argument.
 */
export interface PluginApi {
  React: typeof import('react');
  createElement: (typeof import('react'))['createElement'];
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

/**
 * Signature of a plugin's default export. Plugins are packaged as ESM
 * modules; the host calls `mod.default(api)` during load, receiving an
 * AppPlugin in return.
 */
export type PluginFactory = (api: PluginApi) => AppPlugin;
