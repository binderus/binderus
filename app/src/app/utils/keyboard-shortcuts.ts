/**
 * Description: Centralized keyboard shortcut definitions and handler. All app-wide
 *   shortcuts are defined here and dispatched via a single document-level keydown listener.
 * Requirements: None (pure TypeScript, no dependencies)
 * Inputs: Action callbacks provided by the consuming component via ShortcutActions
 * Outputs: Registers/unregisters a global keydown listener; calls actions on match
 */
import { getOS, OS } from './base-utils';

/** Whether the Cmd (Mac) or Ctrl (Win/Linux) modifier is pressed. */
const isCmdKey = (e: KeyboardEvent): boolean =>
  getOS() === OS.Mac ? e.metaKey : e.ctrlKey;

/** Shortcut definition for display/documentation purposes. */
export interface ShortcutDef {
  id: string;
  /** i18n key for the human-readable label */
  labelKey: string;
  /** Mac display string (e.g. "⌘\\") */
  mac: string;
  /** Win/Linux display string (e.g. "Ctrl+\\") */
  win: string;
}

/** All app shortcut definitions — single source of truth for display in UI / docs. */
export const SHORTCUTS: ShortcutDef[] = [
  { id: 'quick-switcher',  labelKey: 'SHORTCUT_QUICK_SWITCHER',  mac: '⌘ P',        win: 'Ctrl P' },
  { id: 'settings',        labelKey: 'SHORTCUT_OPEN_SETTINGS',   mac: '⌘ ,',        win: 'Ctrl ,' },
  { id: 'toggle-sidebar',  labelKey: 'SHORTCUT_TOGGLE_SIDEBAR',  mac: '⌘ \\',       win: 'Ctrl \\' },
  { id: 'search',          labelKey: 'SHORTCUT_SEARCH_FILES',    mac: '⌘ /',        win: 'Ctrl /' },
  { id: 'raw-panel',       labelKey: 'SHORTCUT_RAW_PANEL',       mac: '⌘ ;',        win: 'Ctrl ;' },
  { id: 'toggle-editor-mode', labelKey: 'SHORTCUT_TOGGLE_EDITOR_MODE', mac: '⌘ .',   win: 'Ctrl .' },
  { id: 'lock',            labelKey: 'SHORTCUT_LOCK_APP',        mac: '⌘ ⇧ L',      win: 'Ctrl Shift L' },
  { id: 'close-tab',       labelKey: 'SHORTCUT_CLOSE_TAB',       mac: '⌘ W',        win: 'Ctrl W' },
  { id: 'next-tab',        labelKey: 'SHORTCUT_NEXT_TAB',        mac: '⌘ ⇧ ]',      win: 'Ctrl Shift ]' },
  { id: 'prev-tab',        labelKey: 'SHORTCUT_PREV_TAB',        mac: '⌘ ⇧ [',      win: 'Ctrl Shift [' },
  { id: 'prev-mode-tab',   labelKey: 'SHORTCUT_PREV_SIDEBAR_TAB',mac: '⌘ ⇧ <',      win: 'Ctrl Shift <' },
  { id: 'next-mode-tab',   labelKey: 'SHORTCUT_NEXT_SIDEBAR_TAB',mac: '⌘ ⇧ >',      win: 'Ctrl Shift >' },
  { id: 'folder-up',       labelKey: 'SHORTCUT_DIR_UP',          mac: '⌘ ↑',        win: 'Ctrl ↑' },
  { id: 'tab-1-9',         labelKey: 'SHORTCUT_JUMP_TAB',        mac: '⌘ 1–9',      win: 'Ctrl 1–9' },
];

/** Get the display string for a shortcut on the current OS. */
export const getShortcutDisplay = (id: string): string => {
  const def = SHORTCUTS.find((s) => s.id === id);
  if (!def) return '';
  return getOS() === OS.Mac ? def.mac : def.win;
};

/** Callbacks the shortcut handler can invoke. Only provide the ones you need. */
export interface ShortcutActions {
  toggleSidebar: () => void;
  openSearch: () => void;
  openSettings: () => void;
  toggleRawPanel: () => void;
  toggleEditorMode: () => void;
  toggleQuickSwitcher: () => void;
  lockApp: () => void;
  closeActiveTab: () => void;
  nextTab: () => void;
  prevTab: () => void;
  nextModeTab: () => void;
  prevModeTab: () => void;
  jumpToTab: (n: number) => void;
  folderUp: () => void;
  /** Whether encryption is enabled (lock shortcut only fires when true). */
  encryptionEnabled: boolean;
}

/**
 * Register a single document-level keydown listener for all app shortcuts.
 * Returns a cleanup function to remove the listener.
 *
 * Implementation note: combos are resolved via a Map<string, handler> so each
 * keydown is a single hash lookup instead of a 14-`if` linear scan. Keys are
 * normalized: "shift+<lowercased key>" or "<lowercased key>". Aliases for
 * shifted punctuation (',' / '<', '.' / '>') are registered once each so the
 * Map covers both physical layouts without additional branching at dispatch.
 */
type ShortcutHandler = (actions: ShortcutActions) => boolean | void;

const buildShortcutMap = (): Map<string, ShortcutHandler> => {
  const m = new Map<string, ShortcutHandler>();
  m.set('p',       (a) => { a.toggleQuickSwitcher(); });
  m.set(',',       (a) => { a.openSettings(); });
  m.set('shift+,', (a) => { a.openSettings(); });
  m.set('\\',      (a) => { a.toggleSidebar(); });
  m.set('/',       (a) => { a.openSearch(); });
  m.set(';',       (a) => { a.toggleRawPanel(); });
  m.set('.',       (a) => { a.toggleEditorMode(); });
  m.set('w',       (a) => { a.closeActiveTab(); });
  m.set('arrowup', (a) => { a.folderUp(); });
  // Shift-modified combos. `encryptionEnabled` guard returns false so the
  // caller skips preventDefault when the lock shortcut is a no-op.
  m.set('shift+l', (a) => { if (!a.encryptionEnabled) return false; a.lockApp(); });
  m.set('shift+]', (a) => { a.nextTab(); });
  m.set('shift+[', (a) => { a.prevTab(); });
  m.set('shift+<', (a) => { a.prevModeTab(); });
  m.set('shift+>', (a) => { a.nextModeTab(); });
  // Shift+',' / shift+'.' behave like < / > on US layouts without the need
  // to actually type the angle-bracket — mirrors the legacy branch.
  m.set('shift+.', (a) => { a.nextModeTab(); });
  // Note: 'shift+,' is already mapped to openSettings above (Cmd+,).
  // The original code let Cmd+Shift+, fall through to prev-mode-tab; preserve
  // that priority by only using prev-mode-tab when shift+',' wasn't consumed
  // — done via a dedicated check in the dispatcher for shift+',' because the
  // Map can only hold one handler per key.
  // Cmd+1..9 — handled inline in dispatcher (range match), not Map.
  return m;
};

const SHORTCUT_MAP = buildShortcutMap();

export const registerShortcuts = (actions: ShortcutActions): (() => void) => {
  const handler = (e: KeyboardEvent) => {
    if (!isCmdKey(e)) return;

    const key = e.key.toLowerCase();
    const shift = e.shiftKey;

    // Cmd+1..9 — handled first (range match, simpler than Map entries)
    if (!shift && key >= '1' && key <= '9') {
      e.preventDefault();
      actions.jumpToTab(parseInt(key, 10));
      return;
    }

    // Legacy behavior: Cmd+Shift+',' falls through to prev-mode-tab (not
    // settings), so we special-case it before the Map lookup.
    if (shift && key === ',') {
      e.preventDefault();
      actions.prevModeTab();
      return;
    }

    const combo = shift ? `shift+${key}` : key;
    const h = SHORTCUT_MAP.get(combo);
    if (!h) return;
    const result = h(actions);
    // Handler returned explicit `false` → skip preventDefault (e.g. lock
    // shortcut when encryption is disabled).
    if (result !== false) e.preventDefault();
  };

  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
};
