/**
 * Description: Tier-1 plugin manager. Activates plugins at startup, scopes
 *   every contribution (status bar, panel, command, settings) under
 *   `plugin:<id>` for bulk teardown, and guards every host->plugin callsite
 *   with safeCall. This version extends the MVP with three new context
 *   surfaces: ctx.panel, ctx.settings, ctx.commands. Back-compat: Pomodoro
 *   and Word Count continue to run untouched.
 * Inputs: AppPlugin modules passed to activatePlugin().
 * Outputs: live plugin registry + PluginContext factory.
 */

import type { ReactNode } from 'react';
import { useAppStore } from '../hooks/use-app-store';
import { useStatusBarRegistry } from '../components/status-bar/status-bar-registry';
import { t } from '../utils/base-utils';
import { usePanelRegistry } from './panel-registry';
import { createSettingsApi, disposePluginSettings } from './settings-registry';
import { registerPluginShortcut, disposeShortcutsForPlugin } from './shortcut-registry';
import type {
  ActiveDocument,
  AppPlugin,
  PanelHandle,
  PluginCommandDescriptor,
  PluginContext,
  PluginPanelDescriptor,
  PluginStatusBarItem,
  StatusBarItemHandle,
} from './plugin-types';

// -----------------------------------------------------------------
// Registry state
// -----------------------------------------------------------------

interface PluginEntry {
  plugin: AppPlugin;
  deactivate?: () => void;
  /** All unregister callbacks collected by the context (commands, etc.). */
  disposables: Array<() => void>;
}

const known = new Map<string, AppPlugin>();
const active = new Map<string, PluginEntry>();

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function subscribePlugins(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// -----------------------------------------------------------------
// Commands registry (tiny — single module-level set, window event based)
// -----------------------------------------------------------------
//
// The Quick Switcher in app-container already listens for plugin commands
// via a CustomEvent channel (`plugin-command:register` / `plugin-command:remove`).
// If you don't want that channel, see docs/app-container.integration.md for
// a minimal useEffect that reads from this Map directly.

interface CommandEntry {
  pluginId: string;
  desc: PluginCommandDescriptor;
}
const commandEntries = new Map<string, CommandEntry>(); // scopedId -> entry
const commandListeners = new Set<() => void>();
const notifyCommands = () => commandListeners.forEach((l) => l());

export function subscribeCommands(cb: () => void): () => void {
  commandListeners.add(cb);
  return () => commandListeners.delete(cb);
}

export function listPluginCommands(): Array<{ scopedId: string; pluginId: string; desc: PluginCommandDescriptor }> {
  return Array.from(commandEntries.entries()).map(([scopedId, entry]) => ({
    scopedId,
    pluginId: entry.pluginId,
    desc: entry.desc,
  }));
}

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function getActiveDocument(): ActiveDocument {
  const s = useAppStore.getState();
  const tab = s.tabs.find((t) => t.file_path === s.activeTabPath);
  return { path: s.activeTabPath ?? null, content: tab?.content ?? '' };
}

function safeCall<T extends (...args: any[]) => any>(
  label: string,
  fn: T | undefined,
  ...args: Parameters<T>
): ReturnType<T> | undefined {
  if (!fn) return undefined;
  try {
    return fn(...args);
  } catch (err) {
    console.error(`[plugin-manager] ${label} threw`, err);
    return undefined;
  }
}

function interpolate(template: string, vars?: Record<string, unknown>): string {
  if (!vars) return template;
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

function resolvePluginKey(
  plugin: AppPlugin,
  key: string,
  vars?: Record<string, unknown>
): string {
  const lang = useAppStore.getState().lang;
  const primary = plugin.locales?.[lang]?.[key];
  if (primary != null) return interpolate(primary, vars);
  const fallback = plugin.locales?.['en-US']?.[key];
  if (fallback != null) return interpolate(fallback, vars);
  const hostValue = t(key, vars);
  if (hostValue && hostValue !== key) return hostValue;
  return key;
}

// -----------------------------------------------------------------
// Status bar handle
// -----------------------------------------------------------------

function createStatusBarHandle(
  source: `plugin:${string}`,
  scopedId: string,
  originalVisible: (() => boolean) | undefined,
): StatusBarItemHandle {
  let disposed = false;
  let hidden = false;
  const HIDDEN_VISIBLE = () => false;

  return {
    set(partial) {
      if (disposed) return;
      useStatusBarRegistry.getState().update(scopedId, partial);
    },
    show() {
      if (disposed || !hidden) return;
      hidden = false;
      useStatusBarRegistry.getState().update(scopedId, { visible: originalVisible });
    },
    hide() {
      if (disposed || hidden) return;
      hidden = true;
      useStatusBarRegistry.getState().update(scopedId, { visible: HIDDEN_VISIBLE });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      useStatusBarRegistry.getState().remove(scopedId);
    },
  };
}

// -----------------------------------------------------------------
// Panel handle
// -----------------------------------------------------------------

function createPanelHandle(
  scopedId: string,
  _unscopedId: string,
  _pluginId: string,
): PanelHandle {
  let disposed = false;
  return {
    toggle() {
      if (disposed) return;
      usePanelRegistry.getState().toggle(scopedId);
    },
    show() {
      if (disposed) return;
      usePanelRegistry.getState().setVisible(scopedId, true);
    },
    hide() {
      if (disposed) return;
      usePanelRegistry.getState().setVisible(scopedId, false);
    },
    isVisible() {
      if (disposed) return false;
      return !!usePanelRegistry.getState().panels.find((p) => p.id === scopedId)?.visible;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      usePanelRegistry.getState().remove(scopedId);
    },
  };
}

// -----------------------------------------------------------------
// Context factory
// -----------------------------------------------------------------

function createPluginContext(
  plugin: AppPlugin,
  entry: PluginEntry,
): PluginContext {
  const id = plugin.id;
  const source = `plugin:${id}` as const;
  const scoped = (shortId: string) => `${id}:${shortId}`;

  const settingsApi = createSettingsApi(id);

  return {
    id,
    statusBar: {
      create: (item: PluginStatusBarItem): StatusBarItemHandle => {
        const fullId = scoped(item.id);
        const userOnClick = item.onClick;
        const wrappedOnClick = userOnClick
          ? () => safeCall(`plugin:${id}:${item.id} onClick`, userOnClick)
          : undefined;
        useStatusBarRegistry.getState().register({
          ...item,
          id: fullId,
          source,
          onClick: wrappedOnClick,
        });
        return createStatusBarHandle(source, fullId, item.visible);
      },
    },

    panel: {
      register: (desc: PluginPanelDescriptor): PanelHandle => {
        const fullId = scoped(desc.id);
        const originalRender = desc.render;
        const safeRender = (args: { close: () => void }): ReactNode => {
          try {
            return originalRender(args);
          } catch (err) {
            console.error(`[plugin:${id}] panel render threw`, err);
            return null;
          }
        };
        usePanelRegistry.getState().register({
          id: fullId,
          source,
          unscopedId: desc.id,
          title: desc.title,
          render: safeRender,
          widthPct: desc.widthPct ?? 40,
          side: desc.side ?? 'right',
          visible: false,
        });
        const handle = createPanelHandle(fullId, desc.id, id);

        // Auto-register a Cmd+P command unless the plugin opted out.
        if (desc.registerCommand !== false) {
          const cmdId = scoped(`panel:${desc.id}`);
          commandEntries.set(cmdId, {
            pluginId: id,
            desc: {
              id: cmdId,
              label: `Toggle ${desc.title}`,
              onSelect: () => safeCall(`plugin:${id} panel-toggle`, () => handle.toggle()),
            },
          });
          notifyCommands();
          entry.disposables.push(() => {
            commandEntries.delete(cmdId);
            notifyCommands();
          });
        }

        return handle;
      },
      find: (unscopedId: string): PanelHandle | undefined => {
        const fullId = scoped(unscopedId);
        const exists = usePanelRegistry.getState().panels.some((p) => p.id === fullId);
        if (!exists) return undefined;
        return createPanelHandle(fullId, unscopedId, id);
      },
    },

    settings: settingsApi,

    commands: {
      register: (cmd: PluginCommandDescriptor) => {
        const fullId = scoped(cmd.id);
        commandEntries.set(fullId, {
          pluginId: id,
          desc: {
            ...cmd,
            id: fullId,
            onSelect: () => safeCall(`plugin:${id} cmd:${cmd.id}`, cmd.onSelect),
          },
        });
        notifyCommands();
        const unregister = () => {
          commandEntries.delete(fullId);
          notifyCommands();
        };
        entry.disposables.push(unregister);
        return unregister;
      },
    },

    shortcuts: {
      register: (combo: string, callback: () => void) => {
        const wrapped = () => safeCall(`plugin:${id} shortcut:${combo}`, callback);
        const dispose = registerPluginShortcut(id, combo, wrapped);
        entry.disposables.push(dispose);
        return dispose;
      },
    },

    editor: {
      getActiveDocument,
      onDocumentChange: (cb) => {
        let lastPath: string | null = null;
        let lastContent = '';
        const unsub = useAppStore.subscribe((state) => {
          const path = state.activeTabPath ?? null;
          const tab = state.tabs.find((tb) => tb.file_path === path);
          const content = tab?.content ?? '';
          if (path !== lastPath || content !== lastContent) {
            lastPath = path;
            lastContent = content;
            safeCall(`plugin:${id} onDocumentChange`, cb, { path, content });
          }
        });
        entry.disposables.push(unsub);
        return unsub;
      },
    },

    t: (key, vars) => resolvePluginKey(plugin, key, vars),
    onLocaleChange: (cb) => {
      let last = useAppStore.getState().lang;
      const unsub = useAppStore.subscribe((state) => {
        if (state.lang !== last) {
          last = state.lang;
          safeCall(`plugin:${id} onLocaleChange`, cb, state.lang);
        }
      });
      entry.disposables.push(unsub);
      return unsub;
    },
    log: (...args) => console.log(`[plugin:${id}]`, ...args),
  };
}

// -----------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------

export function activatePlugin(plugin: AppPlugin): void {
  known.set(plugin.id, plugin);
  if (active.has(plugin.id)) {
    console.warn(`[plugin-manager] plugin "${plugin.id}" already active — skipping`);
    return;
  }
  const entry: PluginEntry = { plugin, disposables: [] };
  const ctx = createPluginContext(plugin, entry);
  try {
    const maybeDeactivate = plugin.activate(ctx);
    entry.deactivate = typeof maybeDeactivate === 'function' ? maybeDeactivate : undefined;
    active.set(plugin.id, entry);
    notify();
  } catch (err) {
    console.error(`[plugin-manager] plugin "${plugin.id}" failed to activate`, err);
  }
}

export function deactivatePlugin(id: string): void {
  const entry = active.get(id);
  if (!entry) return;
  try {
    entry.deactivate?.();
  } catch (err) {
    console.error(`[plugin-manager] plugin "${id}" deactivate threw`, err);
  }
  // Run every disposable the context collected (commands, subscriptions).
  for (const dispose of entry.disposables) {
    try { dispose(); } catch (err) { console.error(`[plugin-manager] disposable for "${id}" threw`, err); }
  }
  // Bulk-cleanup any resources the plugin forgot to release.
  useStatusBarRegistry.getState().removeBySource(`plugin:${id}`);
  usePanelRegistry.getState().removeBySource(`plugin:${id}`);
  disposeShortcutsForPlugin(id);
  disposePluginSettings(id);
  active.delete(id);
  notify();
}

/**
 * Fully remove a plugin from the registry: deactivate (if running) and
 * drop it from `known` so `listPlugins()` no longer reports it. Used by
 * the uninstall flow after the on-disk files are deleted.
 */
export function unregisterPlugin(id: string): void {
  if (active.has(id)) deactivatePlugin(id);
  if (known.delete(id)) notify();
}

export function setPluginEnabled(id: string, enabled: boolean): void {
  const plugin = known.get(id);
  if (!plugin) return;
  if (enabled) activatePlugin(plugin);
  else deactivatePlugin(id);
}

export interface PluginInfo {
  id: string;
  version: string;
  name: string;
  description: string;
  active: boolean;
  category: 'built-in' | 'user';
}

export function listPlugins(): PluginInfo[] {
  return Array.from(known.values())
    .map((p) => ({
      id: p.id,
      version: p.version,
      name: p.name ?? p.id,
      description: p.description ?? '',
      active: active.has(p.id),
      category: p.category ?? 'built-in',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listActivePlugins(): string[] {
  return Array.from(active.keys());
}
