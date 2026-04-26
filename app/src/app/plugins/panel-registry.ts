/**
 * Description: Zustand store that tracks plugin-contributed slide-out panels.
 *   Mirrors the status-bar-registry pattern — entries are auto-scoped by
 *   `source: 'plugin:<id>'` so a single removeBySource() call cleans up
 *   everything a plugin registered when it is disabled.
 * Inputs: register(desc) from ctx.panel.register; update/remove from PanelHandle.
 * Outputs: hook usePanelRegistry() for PluginPanelsHost to render.
 */

import { create } from 'zustand';
import type { ReactNode } from 'react';

export interface PanelEntry {
  /** Scoped id: `<pluginId>:<unscopedId>`. */
  id: string;
  /** `plugin:<pluginId>` — used for bulk teardown. */
  source: `plugin:${string}`;
  /** Unscoped id authored by the plugin — used by ctx.panel.find(). */
  unscopedId: string;
  title: string;
  render: (args: { close: () => void }) => ReactNode;
  widthPct: number;
  side: 'right' | 'left';
  visible: boolean;
}

interface PanelRegistryState {
  panels: PanelEntry[];
  register(entry: PanelEntry): void;
  update(id: string, partial: Partial<PanelEntry>): void;
  remove(id: string): void;
  removeBySource(source: `plugin:${string}`): void;
  setVisible(id: string, visible: boolean): void;
  toggle(id: string): void;
}

export const usePanelRegistry = create<PanelRegistryState>((set) => ({
  panels: [],
  register: (entry) =>
    set((s) => {
      // Replace if same id already exists (plugin re-activate); else append.
      const idx = s.panels.findIndex((p) => p.id === entry.id);
      if (idx >= 0) {
        const next = s.panels.slice();
        next[idx] = entry;
        return { panels: next };
      }
      return { panels: [...s.panels, entry] };
    }),
  update: (id, partial) =>
    set((s) => ({
      panels: s.panels.map((p) => (p.id === id ? { ...p, ...partial } : p)),
    })),
  remove: (id) =>
    set((s) => ({ panels: s.panels.filter((p) => p.id !== id) })),
  removeBySource: (source) =>
    set((s) => ({ panels: s.panels.filter((p) => p.source !== source) })),
  setVisible: (id, visible) =>
    set((s) => ({
      panels: s.panels.map((p) => (p.id === id ? { ...p, visible } : p)),
    })),
  toggle: (id) =>
    set((s) => ({
      panels: s.panels.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p)),
    })),
}));
