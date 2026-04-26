/**
 * Description: Plugin-side keyboard-shortcut registry. Plugins register a
 *   combo string like "Cmd+L" (Cmd = meta on mac, ctrl elsewhere) and the
 *   host dispatches matching keydowns to their callback. A single
 *   document-level listener is installed at capture phase so plugin
 *   shortcuts take precedence over the built-in app shortcuts in
 *   utils/keyboard-shortcuts.ts when a combo is registered — the plugin
 *   listener calls stopImmediatePropagation() and preventDefault() on
 *   handled events.
 *
 *   Scoping: every entry is tagged with its pluginId so plugin-manager
 *   can bulk-release shortcuts on deactivate via disposeShortcutsForPlugin.
 *
 * Inputs: imported by plugin-manager (for the ctx.shortcuts surface) and
 *   by app-container (which calls startShortcutListener once at boot).
 * Outputs: register/dispose API + a singleton keydown listener.
 */

import { getOS, OS } from '../utils/base-utils';

interface ShortcutEntry {
  pluginId: string;
  combo: string; // normalized
  callback: () => void;
}

// normalized-combo -> ordered list of entries. Last registered wins when
// multiple plugins bind the same combo (later plugin shadows earlier).
const entries = new Map<string, ShortcutEntry[]>();

function isCmdKey(e: KeyboardEvent): boolean {
  return getOS() === OS.Mac ? e.metaKey : e.ctrlKey;
}

/**
 * Normalize "Cmd+Shift+L" → "cmd+shift+l" with modifiers in canonical
 * order: cmd, alt, shift, then the key. "Ctrl" is distinct from "Cmd":
 * Ctrl always means the ctrl key, Cmd means platform-primary modifier.
 */
export function normalizeCombo(combo: string): string {
  const parts = combo.split('+').map((s) => s.trim().toLowerCase()).filter(Boolean);
  let cmd = false;
  let ctrl = false;
  let alt = false;
  let shift = false;
  let key = '';
  for (const p of parts) {
    if (p === 'cmd' || p === 'meta' || p === 'command') cmd = true;
    else if (p === 'ctrl' || p === 'control') ctrl = true;
    else if (p === 'alt' || p === 'option' || p === 'opt') alt = true;
    else if (p === 'shift') shift = true;
    else key = p;
  }
  const mods: string[] = [];
  if (cmd) mods.push('cmd');
  if (ctrl) mods.push('ctrl');
  if (alt) mods.push('alt');
  if (shift) mods.push('shift');
  return [...mods, key].join('+');
}

/** Build the normalized combo string the event matches. */
function comboFromEvent(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (isCmdKey(e)) mods.push('cmd');
  // Treat raw ctrl as distinct only on mac (where it's separate from cmd).
  if (getOS() === OS.Mac && e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  return [...mods, e.key.toLowerCase()].join('+');
}

export function registerPluginShortcut(
  pluginId: string,
  combo: string,
  callback: () => void,
): () => void {
  const normalized = normalizeCombo(combo);
  const list = entries.get(normalized) ?? [];
  const entry: ShortcutEntry = { pluginId, combo: normalized, callback };
  list.push(entry);
  entries.set(normalized, list);
  return () => {
    const cur = entries.get(normalized);
    if (!cur) return;
    const next = cur.filter((x) => x !== entry);
    if (next.length === 0) entries.delete(normalized);
    else entries.set(normalized, next);
  };
}

/** Remove every shortcut owned by a plugin — called on deactivate. */
export function disposeShortcutsForPlugin(pluginId: string): void {
  for (const [combo, list] of entries) {
    const next = list.filter((e) => e.pluginId !== pluginId);
    if (next.length === 0) entries.delete(combo);
    else entries.set(combo, next);
  }
}

let listenerInstalled = false;

/**
 * Install the single document-level keydown listener. Idempotent — safe
 * to call from app bootstrap even if plugins are reloaded later.
 *
 * Capture phase + stopImmediatePropagation ensures plugin shortcuts beat
 * the built-in shortcut handler in utils/keyboard-shortcuts.ts when the
 * same combo is registered.
 */
export function startShortcutListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  document.addEventListener(
    'keydown',
    (e) => {
      if (entries.size === 0) return;
      const combo = comboFromEvent(e);
      const list = entries.get(combo);
      if (!list || list.length === 0) return;
      // Last-registered wins — fine for single-plugin cases like Cmd+L.
      const entry = list[list.length - 1];
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        entry.callback();
      } catch (err) {
        console.error(`[plugin-shortcut] ${entry.pluginId} ${combo} threw`, err);
      }
    },
    { capture: true },
  );
}
