import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { EditorMode, EditorTab, FileType, Theme, themeValues } from '../types';
import { fontNames, fontNameToClassName, isWeb } from '../utils/base-utils';
import { DEFAULT_THEME } from '../utils/constants';
import { readVaultSettings, readVaultSettingsLatest, writeVaultSettings, readGlobalSettings, writeGlobalSettings } from '../utils/tauri-utils';
import { loadTheme } from '../utils/theme-registry';

type Updater<T> = T | ((prev: T) => T);
const resolve = <T,>(updater: Updater<T>, prev: T): T =>
  typeof updater === 'function' ? (updater as (prev: T) => T)(prev) : updater;

// Rebuilds the `tabsById` lookup from the canonical `tabs` array.
// Preserves referential stability for unchanged tabs because each entry in
// `tabs` is itself produced with object-spread on mutation — so tabs that
// weren't touched by the current action keep their old reference, and their
// `tabsById[path]` entry stays === between renders. Called in every tab-mutating
// action so the two stay in lock-step.
const buildTabsById = (tabs: EditorTab[]): Record<string, EditorTab> => {
  const out: Record<string, EditorTab> = {};
  for (const t of tabs) out[t.file_path] = t;
  return out;
};

export interface AppState {
  // File navigation
  refreshFolder: boolean;
  recentList: FileType[];
  folderStack: FileType[];
  openedFiles: FileType[];
  favourites: FileType[];

  // Tabs — `tabs` is the ordered array (drives TabBar + persistence). `tabsById` is
  // a derived lookup map kept in lock-step with `tabs` on every mutation so
  // per-tab consumers can do O(1) access with referential stability: the entry
  // for tab X keeps its old reference when tab Y is the one that changed.
  // Combined with `useShallow` on `s.tabs` this cuts tab-bar + editor-panel
  // re-renders on keystroke from O(tabs) to O(1).
  tabs: EditorTab[];
  tabsById: Record<string, EditorTab>;
  activeTabPath: string | null;

  // Settings
  settingJson: any;
  dataDir: string;
  vaultPath: string;
  theme: Theme;
  lang: string;
  editorFont: string;
  editorColor: string;
  editorBgColor: string;
  settingEmail: string;
  clientUuid: string;
  storageBackend: string;
  encryptionEnabled: boolean;
  autoLockTimeout: number;
  autoLockOnMinimize: boolean;
  enterMode: 'normal' | 'paragraph';
  sidebarView: 'flat' | 'tree';
  isLocked: boolean;

  // Actions — file navigation
  setRefreshFolder: (flag: Updater<boolean>) => void;
  setRecentList: (updater: Updater<FileType[]>) => void;
  setFolderStack: (updater: Updater<FileType[]>) => void;
  setOpenedFiles: (updater: Updater<FileType[]>) => void;
  setFavourites: (updater: Updater<FileType[]>) => void;
  setDeletingItem: (item: FileType | null) => void;

  // Actions — tabs
  openTab: (file: FileType) => void;
  closeTab: (filePath: string) => void;
  setActiveTab: (filePath: string) => void;
  reorderTab: (fromIndex: number, toIndex: number) => void;
  updateTabContent: (filePath: string, content: string) => void;
  markTabDirty: (filePath: string, isDirty: boolean) => void;
  setTabEditorMode: (filePath: string, mode: EditorMode) => void;
  closeOtherTabs: (filePath: string) => void;
  closeAllTabs: () => void;
  renameTab: (oldPath: string, newPath: string, newName: string) => void;

  // Actions — settings
  setSettingJson: (json: any) => void;
  setDataDir: (dir: string) => void;
  setVaultPath: (path: string) => void;
  setTheme: (theme: Updater<Theme>) => void;
  setLang: (lang: Updater<string>) => void;
  setEditorFont: (font: Updater<string>) => void;
  setEditorColor: (color: Updater<string>) => void;
  setEditorBgColor: (color: Updater<string>) => void;
  setSettingEmail: (email: Updater<string>) => void;
  setClientUuid: (uuid: Updater<string>) => void;
  setStorageBackend: (backend: Updater<string>) => void;
  setEncryptionEnabled: (enabled: Updater<boolean>) => void;
  setAutoLockTimeout: (timeout: Updater<number>) => void;
  setAutoLockOnMinimize: (val: Updater<boolean>) => void;
  setEnterMode: (mode: Updater<'normal' | 'paragraph'>) => void;
  setSidebarView: (view: Updater<'flat' | 'tree'>) => void;
  setIsLocked: (locked: Updater<boolean>) => void;
  isFavourite: (item: FileType | null) => boolean;
}

export const useAppStore = create<AppState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        // Initial state
        refreshFolder: false,
        recentList: [],
        folderStack: [],
        openedFiles: [],
        favourites: [],
        tabs: [],
        tabsById: {},
        activeTabPath: null,
        settingJson: {},
        dataDir: '',
        vaultPath: '',
        theme: Theme.DarkNord,
        lang: '',
        editorFont: '',
        editorColor: '',
        editorBgColor: '',
        settingEmail: '',
        clientUuid: '',
        storageBackend: 'filesystem',
        encryptionEnabled: false,
        autoLockTimeout: 15,
        autoLockOnMinimize: false,
        enterMode: 'paragraph',
        sidebarView: 'tree',
        isLocked: false,

        // Actions — file navigation
        setRefreshFolder: (updater) => set((s) => ({ refreshFolder: resolve(updater, s.refreshFolder) })),
        setRecentList: (updater) => set((s) => ({ recentList: resolve(updater, s.recentList) })),
        setFolderStack: (updater) => set((s) => ({ folderStack: resolve(updater, s.folderStack) })),
        setOpenedFiles: (updater) => set((s) => ({ openedFiles: resolve(updater, s.openedFiles) })),
        setFavourites: (updater) => set((s) => ({ favourites: resolve(updater, s.favourites) })),
        setSettingJson: (json) => set({ settingJson: json }),
        setDataDir: (dir) => set({ dataDir: dir }),
        setVaultPath: (path) => set({ vaultPath: path }),
        setTheme: (updater) => set((s) => ({ theme: resolve(updater, s.theme) })),
        setLang: (updater) => set((s) => ({ lang: resolve(updater, s.lang) })),
        setEditorFont: (updater) => set((s) => ({ editorFont: resolve(updater, s.editorFont) })),
        setEditorColor: (updater) => set((s) => ({ editorColor: resolve(updater, s.editorColor) })),
        setEditorBgColor: (updater) => set((s) => ({ editorBgColor: resolve(updater, s.editorBgColor) })),
        setSettingEmail: (updater) => set((s) => ({ settingEmail: resolve(updater, s.settingEmail) })),
        setClientUuid: (updater) => set((s) => ({ clientUuid: resolve(updater, s.clientUuid) })),
        setStorageBackend: (updater) => set((s) => ({ storageBackend: resolve(updater, s.storageBackend) })),
        setEncryptionEnabled: (updater) =>
          set((s) => ({ encryptionEnabled: resolve(updater, s.encryptionEnabled) })),
        setAutoLockTimeout: (updater) =>
          set((s) => ({ autoLockTimeout: resolve(updater, s.autoLockTimeout) })),
        setAutoLockOnMinimize: (updater) =>
          set((s) => ({ autoLockOnMinimize: resolve(updater, s.autoLockOnMinimize) })),
        setEnterMode: (updater) =>
          set((s) => ({ enterMode: resolve(updater, s.enterMode) })),
        setSidebarView: (updater) =>
          set((s) => ({ sidebarView: resolve(updater, s.sidebarView) })),
        setIsLocked: (updater) => set((s) => ({ isLocked: resolve(updater, s.isLocked) })),

        setDeletingItem: (item) => {
          if (!item) return;
          const s = get();
          const newTabs = s.tabs.filter((t) => t.file_path !== item.file_path);
          let newActiveTabPath = s.activeTabPath;
          if (s.activeTabPath === item.file_path) {
            const closedIdx = s.tabs.findIndex((t) => t.file_path === item.file_path);
            newActiveTabPath = newTabs[closedIdx]?.file_path ?? newTabs[closedIdx - 1]?.file_path ?? null;
          }
          set({
            tabs: newTabs,
            tabsById: buildTabsById(newTabs),
            activeTabPath: newActiveTabPath,
            openedFiles: s.openedFiles.filter((f) => f.file_path !== item.file_path),
            recentList: s.recentList.filter((f) => f.file_path !== item.file_path),
            favourites: s.favourites.filter((f) => f.file_path !== item.file_path)
          });
        },

        isFavourite: (item) => {
          if (!item) return false;
          return get().favourites.some((f) => f.file_path === item.file_path);
        },

        // Actions — tabs
        openTab: (file) => {
          const s = get();
          const existing = s.tabs.find((t) => t.file_path === file.file_path);
          if (existing) {
            set({ activeTabPath: file.file_path, openedFiles: [file] });
          } else {
            const newTab: EditorTab = {
              file_path: file.file_path,
              file_name: file.file_name,
              content: null,
              isDirty: false
            };
            const newTabs = [...s.tabs, newTab];
            set({
              tabs: newTabs,
              tabsById: buildTabsById(newTabs),
              activeTabPath: file.file_path,
              openedFiles: [file]
            });
          }
        },

        closeTab: (filePath) => {
          const s = get();
          const closedIdx = s.tabs.findIndex((t) => t.file_path === filePath);
          if (closedIdx === -1) return;
          const newTabs = s.tabs.filter((t) => t.file_path !== filePath);
          let newActiveTabPath = s.activeTabPath;
          if (s.activeTabPath === filePath) {
            newActiveTabPath = newTabs[closedIdx]?.file_path ?? newTabs[closedIdx - 1]?.file_path ?? null;
          }
          const activeTab = newActiveTabPath ? newTabs.find((t) => t.file_path === newActiveTabPath) : null;
          set({
            tabs: newTabs,
            tabsById: buildTabsById(newTabs),
            activeTabPath: newActiveTabPath,
            openedFiles: activeTab
              ? [{ file_path: activeTab.file_path, file_name: activeTab.file_name, file_text: '', is_file: true, is_dir: false }]
              : [],
            // Navigate sidebar back to root when last tab is closed
            ...(newTabs.length === 0 ? { folderStack: [] } : {})
          });
        },

        setActiveTab: (filePath) => {
          const s = get();
          const tab = s.tabs.find((t) => t.file_path === filePath);
          if (!tab) return;
          set({
            activeTabPath: filePath,
            openedFiles: [{ file_path: tab.file_path, file_name: tab.file_name, file_text: '', is_file: true, is_dir: false }]
          });
        },

        reorderTab: (fromIndex, toIndex) => {
          const tabs = [...get().tabs];
          const [moved] = tabs.splice(fromIndex, 1);
          tabs.splice(toIndex, 0, moved);
          // tabsById rebuild is cheap here and reorder doesn't change which
          // tab lives at which path, so references stay === for consumers
          // reading by path.
          set({ tabs, tabsById: buildTabsById(tabs) });
        },

        updateTabContent: (filePath, content) => {
          set((s) => {
            const newTabs = s.tabs.map((t) => (t.file_path === filePath ? { ...t, content } : t));
            return { tabs: newTabs, tabsById: buildTabsById(newTabs) };
          });
        },

        markTabDirty: (filePath, isDirty) => {
          set((s) => {
            const newTabs = s.tabs.map((t) => (t.file_path === filePath ? { ...t, isDirty } : t));
            return { tabs: newTabs, tabsById: buildTabsById(newTabs) };
          });
        },

        setTabEditorMode: (filePath, editorMode) => {
          set((s) => {
            const newTabs = s.tabs.map((t) => (t.file_path === filePath ? { ...t, editorMode } : t));
            return { tabs: newTabs, tabsById: buildTabsById(newTabs) };
          });
        },

        closeOtherTabs: (filePath) => {
          const s = get();
          const kept = s.tabs.filter((t) => t.file_path === filePath);
          set({ tabs: kept, tabsById: buildTabsById(kept), activeTabPath: filePath });
        },

        closeAllTabs: () => {
          set({ tabs: [], tabsById: {}, activeTabPath: null, openedFiles: [] });
        },

        renameTab: (oldPath, newPath, newName) => {
          set((s) => {
            const newTabs = s.tabs.map((t) =>
              t.file_path === oldPath ? { ...t, file_path: newPath, file_name: newName } : t
            );
            return {
              tabs: newTabs,
              tabsById: buildTabsById(newTabs),
              activeTabPath: s.activeTabPath === oldPath ? newPath : s.activeTabPath
            };
          });
        }
      }),
      {
        name: 'binderus-tabs',
        version: 1,
        migrate: (persisted: any) => {
          if (persisted?.tabs) {
            persisted.tabs = persisted.tabs.map((t: any) => ({ ...t, content: null }));
          }
          return persisted;
        },
        partialize: (state) => ({
          tabs: state.tabs.map((t) => ({
            file_path: t.file_path,
            file_name: t.file_name,
            content: null,
            isDirty: false,
            editorMode: t.editorMode
          })),
          activeTabPath: state.activeTabPath,
          sidebarView: state.sidebarView
        }),
        // `tabsById` is derived state — not persisted. Rebuild it from the
        // restored `tabs` array once rehydration completes so consumers that
        // read via `s.tabsById[path]` work on first render.
        onRehydrateStorage: () => (state) => {
          if (state) state.tabsById = buildTabsById(state.tabs ?? []);
        }
      }
    )
  )
);

// --- Side-effect subscriptions (run outside React) ---

// Persist favourites + recentList.
// Uses readVaultSettingsLatest() to read the pending debounce buffer (if any) instead of
// disk, preventing read-modify-write races when multiple callers write vault settings.
useAppStore.subscribe(
  (s) => ({ favourites: s.favourites, recentList: s.recentList }),
  async ({ favourites, recentList }) => {
    if (isWeb || favourites.length === 0) return;
    const json: any = await readVaultSettingsLatest();
    const pick = (obj: FileType) => ({
      file_path: obj.file_path,
      file_name: obj.file_name,
      is_dir: obj.is_dir,
      is_file: obj.is_file
    });
    json.favourites = favourites.map(pick);
    json.recent = recentList.map(pick);
    await writeVaultSettings(json);
  },
  { equalityFn: (a, b) => a.favourites === b.favourites && a.recentList === b.recentList }
);

// Load theme CSS and set data-theme attribute on theme change
useAppStore.subscribe(
  (s) => s.theme,
  (theme) => {
    loadTheme(theme ?? DEFAULT_THEME);
  },
  { fireImmediately: true }
);

// Update body class on editorFont change
useAppStore.subscribe(
  (s) => s.editorFont,
  (editorFont) => {
    if (!editorFont) return;
    fontNames.forEach((fn) => document.body.classList.remove(fontNameToClassName(fn)));
    document.body.classList.add(fontNameToClassName(editorFont));
  }
);

// Persist lang change
useAppStore.subscribe(
  (s) => s.lang,
  async (lang) => {
    if (isWeb || !lang) return;
    const json: any = await readGlobalSettings();
    json.lang = lang;
    await writeGlobalSettings(json);
  }
);
