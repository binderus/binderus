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
  { id: 'lock',            labelKey: 'SHORTCUT_LOCK_APP',        mac: '⌘ L',        win: 'Ctrl L' },
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
 */
export const registerShortcuts = (actions: ShortcutActions): (() => void) => {
  const handler = (e: KeyboardEvent) => {
    if (!isCmdKey(e)) return;

    const key = e.key.toLowerCase();
    const shift = e.shiftKey;

    // Cmd+P — Quick Switcher
    if (key === 'p' && !shift) {
      e.preventDefault();
      actions.toggleQuickSwitcher();
      return;
    }
    // Cmd+, — Settings
    if (e.key === ',') {
      e.preventDefault();
      actions.openSettings();
      return;
    }
    // Cmd+\ — Toggle sidebar
    if (e.key === '\\' && !shift) {
      e.preventDefault();
      actions.toggleSidebar();
      return;
    }
    // Cmd+/ — Search
    if (e.key === '/' && !shift) {
      e.preventDefault();
      actions.openSearch();
      return;
    }
    // Cmd+; — Raw markdown panel
    if (e.key === ';' && !shift) {
      e.preventDefault();
      actions.toggleRawPanel();
      return;
    }
    // Cmd+L — Lock app (only when encryption enabled)
    if (key === 'l' && !shift && actions.encryptionEnabled) {
      e.preventDefault();
      actions.lockApp();
      return;
    }
    // Cmd+W — Close active tab
    if (key === 'w' && !shift) {
      e.preventDefault();
      actions.closeActiveTab();
      return;
    }
    // Cmd+Shift+] — Next tab
    if (e.key === ']' && shift) {
      e.preventDefault();
      actions.nextTab();
      return;
    }
    // Cmd+Shift+[ — Previous tab
    if (e.key === '[' && shift) {
      e.preventDefault();
      actions.prevTab();
      return;
    }
    // Cmd+Shift+< (Cmd+Shift+,) — Previous mode tab
    if (e.key === '<' || (e.key === ',' && shift)) {
      e.preventDefault();
      actions.prevModeTab();
      return;
    }
    // Cmd+Shift+> (Cmd+Shift+.) — Next mode tab
    if (e.key === '>' || (e.key === '.' && shift)) {
      e.preventDefault();
      actions.nextModeTab();
      return;
    }
    // Cmd+Up — Go up one directory level in sidebar
    if (e.key === 'ArrowUp' && !shift) {
      e.preventDefault();
      actions.folderUp();
      return;
    }
    // Cmd+1..9 — Jump to tab N
    if (!shift && key >= '1' && key <= '9') {
      e.preventDefault();
      actions.jumpToTab(parseInt(key, 10));
      return;
    }
  };

  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
};
