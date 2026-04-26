/**
 * Description: Registry for status bar items. Both built-in and plugin items
 *   use the same registry. The StatusBar component renders items from this
 *   registry sorted by alignment and priority.
 * Inputs: StatusBarItemDescriptor objects via register/update/remove.
 * Outputs: Reactive item list consumed by StatusBar component via Zustand.
 */

import { create } from 'zustand';

export interface StatusBarHoverAction {
  id: string;
  label: string;
  onClick: () => void;
}

export interface StatusBarItemDescriptor {
  id: string;
  text: string;
  tooltip?: string;
  align: 'left' | 'right';
  priority: number;
  source: 'built-in' | `plugin:${string}`;
  onClick?: () => void;
  visible?: () => boolean;
  hoverActions?: StatusBarHoverAction[];
}

interface StatusBarRegistryState {
  items: Map<string, StatusBarItemDescriptor>;
  register: (item: StatusBarItemDescriptor) => void;
  update: (id: string, partial: Partial<Omit<StatusBarItemDescriptor, 'id' | 'source'>>) => void;
  remove: (id: string) => void;
  removeBySource: (source: string) => void;
  getItems: (align: 'left' | 'right') => StatusBarItemDescriptor[];
}

const MAX_ITEMS_PER_SIDE = 6;
const MAX_TEXT_LENGTH = 30;

// Pure helper — takes items directly so callers (selectors, store methods) share one impl.
export function filterStatusBarItems(
  items: Map<string, StatusBarItemDescriptor>,
  align: 'left' | 'right',
): StatusBarItemDescriptor[] {
  const filtered: StatusBarItemDescriptor[] = [];
  for (const item of items.values()) {
    if (item.align !== align) continue;
    // A plugin's visible() fn is untrusted in the failure sense — if it
    // throws, treat as hidden and log; do not break the render loop.
    if (item.visible) {
      let v = true;
      try {
        v = item.visible();
      } catch (err) {
        console.error(`[status-bar] visible() threw for "${item.id}"`, err);
        v = false;
      }
      if (!v) continue;
    }
    filtered.push(item);
  }
  filtered.sort((a, b) => b.priority - a.priority);
  return filtered.slice(0, MAX_ITEMS_PER_SIDE);
}

// Sanitize text: strip HTML tags, truncate
function sanitizeText(text: string): string {
  const stripped = text.replace(/<[^>]*>/g, '');
  if (stripped.length > MAX_TEXT_LENGTH) {
    return stripped.slice(0, MAX_TEXT_LENGTH - 1) + '\u2026';
  }
  return stripped;
}

export const useStatusBarRegistry = create<StatusBarRegistryState>((set, get) => ({
  items: new Map(),

  register(item) {
    set((state) => {
      const next = new Map(state.items);
      next.set(item.id, { ...item, text: sanitizeText(item.text) });
      return { items: next };
    });
  },

  update(id, partial) {
    set((state) => {
      const existing = state.items.get(id);
      if (!existing) return state;
      const next = new Map(state.items);
      const updated = { ...existing, ...partial };
      if (partial.text !== undefined) {
        updated.text = sanitizeText(partial.text);
      }
      next.set(id, updated);
      return { items: next };
    });
  },

  remove(id) {
    set((state) => {
      const next = new Map(state.items);
      next.delete(id);
      return { items: next };
    });
  },

  removeBySource(source) {
    set((state) => {
      const next = new Map(state.items);
      for (const [id, item] of next) {
        if (item.source === source) next.delete(id);
      }
      return { items: next };
    });
  },

  getItems(align) {
    return filterStatusBarItems(get().items, align);
  }
}));
