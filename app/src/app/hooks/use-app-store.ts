import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { EditorTab, FileType, Theme, themeValues } from '../types';
import { fontNames, fontNameToClassName, isWeb } from '../utils/base-utils';
import { DEFAULT_THEME } from '../utils/constants';
import { readVaultSettings, writeVaultSettings, readGlobalSettings, writeGlobalSettings } from '../utils/tauri-utils';
import { loadTheme } from '../utils/theme-registry';

type Updater<T> = T | ((prev: T) => T);
const resolve = <T,>(updater: Updater<T>, prev: T): T =>
  typeof updater === 'function' ? (updater as (prev: T) => T)(prev) : updater;

export interface AppState {
  // File navigation
  refreshFolder: boolean;
  recentList: FileType[];
  folderStack: FileType[];
  openedFiles: FileType[];
  favourites: FileType[];

  // Tabs
  tabs: EditorTab[];
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
        storageBackend: 'filesystem',
        encryptionEnabled: false,
        autoLockTimeout: 15,
        autoLockOnMinimize: false,
        enterMode: 'paragraph',
        sidebarView: 'flat',
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
            set({
              tabs: [...s.tabs, newTab],
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
          set({ tabs });
        },

        updateTabContent: (filePath, content) => {
          set((s) => ({
            tabs: s.tabs.map((t) => (t.file_path === filePath ? { ...t, content } : t))
          }));
        },

        markTabDirty: (filePath, isDirty) => {
          set((s) => ({
            tabs: s.tabs.map((t) => (t.file_path === filePath ? { ...t, isDirty } : t))
          }));
        },

        closeOtherTabs: (filePath) => {
          const s = get();
          const kept = s.tabs.filter((t) => t.file_path === filePath);
          set({ tabs: kept, activeTabPath: filePath });
        },

        closeAllTabs: () => {
          set({ tabs: [], activeTabPath: null, openedFiles: [] });
        },

        renameTab: (oldPath, newPath, newName) => {
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.file_path === oldPath ? { ...t, file_path: newPath, file_name: newName } : t
            ),
            activeTabPath: s.activeTabPath === oldPath ? newPath : s.activeTabPath
          }));
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
            isDirty: false
          })),
          activeTabPath: state.activeTabPath
        })
      }
    )
  )
);

// --- Side-effect subscriptions (run outside React) ---

// Persist favourites + recentList
useAppStore.subscribe(
  (s) => ({ favourites: s.favourites, recentList: s.recentList }),
  async ({ favourites, recentList }) => {
    if (isWeb || favourites.length === 0) return;
    const json: any = await readVaultSettings();
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
