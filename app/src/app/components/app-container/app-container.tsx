import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { FileType, PageProps } from '../../types';
import AppFileList from '../app-file-list/app-file-list';
import { getFileFromInternalLink, lockDb, renameFile } from '../../utils/tauri-utils';
import { mockReadFile } from '../../utils/mock-data';
import { useAppContext } from '../../hooks/use-app-context';
import NewsModal from '../modal/news-modal';
import FeedbackModal from '../modal/feedback-modal';
import AppModeTabs, { ModeTab, nextTab, previousTab } from '../app-mode-tabs/app-mode-tabs';
import AppEditorPanel from '../app-editor-panel/app-editor-panel';
import AppSearchPanel from '../app-search-panel/app-search-panel';
import TabBar from '../tab-bar/tab-bar';
import RawMdPanel from '../raw-md-panel/raw-md-panel';
import { AiOutlineQuestionCircle } from 'react-icons/ai';

const SettingModal = lazy(() => import('../modal/setting-modal'));
import QuickSwitcherModal from '../quick-switcher/quick-switcher-modal';
import type { AppCommand } from '../quick-switcher/quick-switcher-modal';
import { BsGear as BsGearCmd, BsLock, BsXCircle, BsBoxArrowUpRight, BsLayoutSidebarReverse, BsFolderSymlink, BsPrinter, BsStarFill } from 'react-icons/bs';
import { toast as reactToast } from 'react-toastify';
import { Tooltip } from '../tooltip/tooltip';
import { BINDERUS_WEB_URL } from '../../utils/constants';
import { getUserGuideUrl } from '../../utils/base-utils';
import {
  addItemtoRecentList,
  enhanceEditor,
  extractParentPath,
  focusEditor,
  isWeb,
  sanitizeInternalLink,
  setFavouriteItem,
  splitFilePath,
  t
} from '../../utils/base-utils';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { getPath } from '../../utils/tauri-utils';
import { BsArrowBarRight, BsGear } from 'react-icons/bs';
import { useAppStore } from '../../hooks/use-app-store';
import { registerShortcuts, getShortcutDisplay } from '../../utils/keyboard-shortcuts';

const SIDEBAR_DEFAULT_W = 288; // 18rem (w-72)
const SIDEBAR_MIN_W = 200;
const SIDEBAR_MAX_W = 480;

export default ({}: PageProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const {
    setRefreshFolder,
    setRecentList,
    encryptionEnabled,
    setIsLocked,
    setFolderStack
  } = useAppContext();

  const lang = useAppStore((s) => s.lang);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabPath = useAppStore((s) => s.activeTabPath);
  const openTab = useAppStore((s) => s.openTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const updateTabContent = useAppStore((s) => s.updateTabContent);
  const markTabDirty = useAppStore((s) => s.markTabDirty);
  const renameTabAction = useAppStore((s) => s.renameTab);

  const activeTab = useAppStore((s) => s.tabs.find((t) => t.file_path === s.activeTabPath));

  const [newsModalOpened, setNewsModalOpened] = useState(false);
  const [feedbackModalOpened, setFeedbackModalOpened] = useState(false);
  const [settingModalOpened, setSettingModalOpened] = useState(false);
  const [quickSwitcherOpened, setQuickSwitcherOpened] = useState(false);
  const [modeTab, setModeTab] = useState(ModeTab.ALL);
  const [sidebarShowed, setSidebarShowed] = useState(true);
  const [rawPanelVisible, setRawPanelVisible] = useState(false);
  const [rawSaveVersion, setRawSaveVersion] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_W);
  const [isDragging, setIsDragging] = useState(false);
  const hydrationDone = useRef(false);

  // Sidebar drag-to-resize: uses pointer events for snappy, jank-free resizing.
  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startW = sidebarWidth;

    const onMove = (ev: PointerEvent) => {
      const newW = Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, startW + (ev.clientX - startX)));
      setSidebarWidth(newW);
    };
    const onUp = () => {
      setIsDragging(false);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [sidebarWidth]);

  // All keyboard shortcuts — centralized in keyboard-shortcuts.ts, dispatched via
  // a single document-level keydown listener that works even when the editor has focus.
  useEffect(() => {
    return registerShortcuts({
      toggleQuickSwitcher: () => setQuickSwitcherOpened((v) => !v),
      openSettings: () => setSettingModalOpened(true),
      toggleSidebar: () => setSidebarShowed((v) => !v),
      openSearch: () => {
        setModeTab(ModeTab.SEARCH);
        const el = document.querySelector('[data-id="searchInput"]');
        if (el) { (el as HTMLInputElement).select(); (el as HTMLInputElement).focus(); }
      },
      toggleRawPanel: () => setRawPanelVisible((v) => !v),
      lockApp: async () => { await lockDb(); setIsLocked(true); },
      closeActiveTab: () => {
        const { activeTabPath: path, closeTab: close } = useAppStore.getState();
        if (path) close(path);
      },
      nextTab: () => {
        const { tabs: allTabs, activeTabPath: atp, setActiveTab: sat } = useAppStore.getState();
        if (allTabs.length <= 1) return;
        const idx = allTabs.findIndex((tab) => tab.file_path === atp);
        sat(allTabs[(idx + 1) % allTabs.length].file_path);
      },
      prevTab: () => {
        const { tabs: allTabs, activeTabPath: atp, setActiveTab: sat } = useAppStore.getState();
        if (allTabs.length <= 1) return;
        const idx = allTabs.findIndex((tab) => tab.file_path === atp);
        sat(allTabs[(idx - 1 + allTabs.length) % allTabs.length].file_path);
      },
      nextModeTab: () => setModeTab((tab) => nextTab(tab)),
      prevModeTab: () => setModeTab((tab) => previousTab(tab)),
      jumpToTab: (n) => {
        const tab = useAppStore.getState().tabs[n - 1];
        if (tab) useAppStore.getState().setActiveTab(tab.file_path);
      },
      folderUp: () => {
        setFolderStack((stack) => {
          if (stack.length === 0) return stack;
          const newStack = [...stack];
          newStack.pop();
          return newStack;
        });
      },
      encryptionEnabled,
    });
  }, [encryptionEnabled]);

  // Tauri menu events (macOS native menu items that bypass the WebView keydown)
  useEffect(() => {
    if (isWeb) return;
    const unlistenSettings = listen('open-settings', () => setSettingModalOpened(true));
    const unlistenCloseTab = listen('close-tab', () => {
      const { activeTabPath: path, closeTab: close } = useAppStore.getState();
      if (path) close(path);
    });
    return () => {
      unlistenSettings.then((f) => f());
      unlistenCloseTab.then((f) => f());
    };
  }, []);

  /** Apply disk content to a tab and force-remount the editor. */
  const applyDiskContent = (filePath: string, diskContent: string) => {
    updateTabContent(filePath, diskContent);
    markTabDirty(filePath, false);
    setRawSaveVersion((v) => v + 1);
  };

  /** Non-blocking: read file from disk and update tab if content changed externally. */
  const refreshTabFromDisk = async (filePath: string) => {
    try {
      const tab = useAppStore.getState().tabs.find((t) => t.file_path === filePath);
      if (!tab || tab.content === null || tab.content === undefined) return;

      const diskContent: string = isWeb
        ? (mockReadFile(filePath) ?? '')
        : `${(await invoke('read_file', { filePath })) ?? ''}`;

      // Re-check after async gap
      const freshTab = useAppStore.getState().tabs.find((t) => t.file_path === filePath);
      if (!freshTab || freshTab.content === null) return;
      if (diskContent === freshTab.content) return;

      // Tab has unsaved edits — let the user decide
      if (freshTab.isDirty) {
        const fileName = splitFilePath(filePath).fileName;
        const toastId = `file-changed-${filePath}`;
        // Don't stack duplicate toasts for the same file
        if (reactToast.isActive(toastId)) return;
        reactToast(
          <div>
            <div style={{ marginBottom: 8 }}>{t('FILE_CHANGED_EXTERNALLY', { fileName })}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="dialog-btn" onClick={() => { applyDiskContent(filePath, diskContent); reactToast.dismiss(toastId); }}>
                {t('FILE_CHANGED_LOAD_DISK')}
              </button>
              <button className="dialog-btn" onClick={() => reactToast.dismiss(toastId)}>
                {t('FILE_CHANGED_KEEP_MINE')}
              </button>
            </div>
          </div>,
          { type: 'warning', toastId, autoClose: false }
        );
        return;
      }

      applyDiskContent(filePath, diskContent);
    } catch {
      // File may have been deleted externally — ignore silently
    }
  };

  const loadTabContent = async (filePath: string) => {
    setIsLoading(true);
    try {
      let content: any = isWeb ? mockReadFile(filePath) : await invoke('read_file', { filePath });
      content = content ?? '';
      updateTabContent(filePath, `${content}`);

      const file = tabs.find((t) => t.file_path === filePath) ?? { file_path: filePath, file_name: splitFilePath(filePath).fileName, file_text: '', is_file: true, is_dir: false };
      enhanceEditor({
        file: file as FileType,
        folder: null,
        internalLinkClicked: async (e) => {
          const matchedItem = await getFileFromInternalLink(e?.href);
          if (matchedItem) {
            onFileSelect(matchedItem);
          } else {
            alert(`${t('ERR_INVALID_LINK')}: ${sanitizeInternalLink(e?.href)}`);
          }
        }
      });
      requestAnimationFrame(() => {
        setIsLoading(false);
        focusEditor(true);
        setRecentList((list) => addItemtoRecentList(list, file as FileType));
      });
    } catch {
      closeTab(filePath);
      setIsLoading(false);
    }
  };

  // Load active tab content and sync sidebar when active tab changes
  useEffect(() => {
    if (!activeTabPath) return;

    // Don't reveal in sidebar while search results are visible — user wants to keep clicking through results
    if (modeTab !== ModeTab.SEARCH) {
      revealFileInSidebar(activeTabPath);
    }

    const tab = tabs.find((t) => t.file_path === activeTabPath);
    if (tab && tab.content === null) {
      loadTabContent(activeTabPath);
    } else if (tab && tab.content !== null) {
      setIsLoading(false);
      const file: FileType = { file_path: tab.file_path, file_name: tab.file_name, file_text: '', is_file: true, is_dir: false };
      enhanceEditor({
        file,
        folder: null,
        internalLinkClicked: async (e) => {
          const matchedItem = await getFileFromInternalLink(e?.href);
          if (matchedItem) {
            onFileSelect(matchedItem);
          } else {
            alert(`${t('ERR_INVALID_LINK')}: ${sanitizeInternalLink(e?.href)}`);
          }
        }
      });
      requestAnimationFrame(() => focusEditor(true));
      // Background: check if file changed on disk since it was cached
      refreshTabFromDisk(activeTabPath);
    }
  }, [activeTabPath]);

  // Restore active tab content on hydration from localStorage
  useEffect(() => {
    if (hydrationDone.current) return;
    hydrationDone.current = true;
    if (tabs.length > 0 && activeTabPath) {
      const tab = tabs.find((t) => t.file_path === activeTabPath);
      if (tab && tab.content === null) {
        loadTabContent(activeTabPath);
      }
    }
  }, []);

  const onFolderSelect = async (item: FileType | null) => {
    // no-op kept for prop compatibility
  };

  const onFileSelect = async (file: FileType | null) => {
    if (!file || file?.is_dir) return;
    openTab(file);
    // Navigate sidebar to the file's folder when selecting from FAV/RECENT/SEARCH
    if (modeTab !== ModeTab.ALL) {
      revealFileInSidebar(file.file_path);
    }
    // Use cached content if the tab is already open; only read from disk for new tabs
    const existing = useAppStore.getState().tabs.find((t) => t.file_path === file.file_path);
    if (!existing || existing.content === null) {
      loadTabContent(file.file_path);
    } else {
      // Background: check if file changed on disk since it was cached
      refreshTabFromDisk(file.file_path);
    }
  };

  // Tab → sidebar sync: navigate sidebar to the file's parent folder
  const revealFileInSidebar = async (filePath: string) => {
    const parentPath = extractParentPath(filePath).replace(/\\/g, '/');
    if (!parentPath) return;

    const rootPath = (isWeb ? '' : await getPath('', true)).replace(/\\/g, '/');
    // Remove trailing slash for clean comparison
    const cleanRoot = rootPath.replace(/\/+$/, '');

    // Build folder stack first, then switch mode tab — avoids race where
    // modeTab change triggers a readDir() with the old (root) folder.
    if (parentPath === cleanRoot) {
      // File is at the root data directory — clear folder stack
      setFolderStack([]);
    } else {
      // Build folder stack from root to the file's parent directory
      // e.g. root="/Users/x/Binderus", parent="/Users/x/Binderus/notes/sub"
      //   → relative = "notes/sub" → segments = ["notes", "sub"]
      const relative = parentPath.startsWith(cleanRoot + '/')
        ? parentPath.slice(cleanRoot.length + 1)
        : parentPath;
      const segments = relative.split('/').filter(Boolean);

      const stack: FileType[] = [];
      let current = cleanRoot;
      for (const seg of segments) {
        current = `${current}/${seg}`;
        stack.push({
          file_path: current,
          file_name: seg,
          file_text: '',
          is_file: false,
          is_dir: true
        });
      }
      setFolderStack(stack);
    }

    setModeTab(ModeTab.ALL);
    // Ensure file list refreshes after folder stack + mode tab are both updated
    requestAnimationFrame(() => setRefreshFolder(true));
  };

  // Quick Switcher app commands — shortcuts pulled from centralized definitions
  const quickSwitcherCommands: AppCommand[] = useMemo(() => [
    { id: 'settings', label: t('APP_MAIN_SETTINGS') || 'Open Settings', icon: <BsGearCmd size={14} />,
      shortcut: getShortcutDisplay('settings'), onSelect: () => setSettingModalOpened(true) },
    { id: 'raw-panel', label: t('APP_RAW_MD_PANEL') || 'Toggle Raw Markdown Panel', icon: <BsLayoutSidebarReverse size={14} />,
      shortcut: getShortcutDisplay('raw-panel'), onSelect: () => setRawPanelVisible((v) => !v) },
    { id: 'toggle-sidebar', label: t('APP_TOGGLE_SIDEBAR') || 'Toggle Sidebar', icon: <BsLayoutSidebarReverse size={14} />,
      shortcut: getShortcutDisplay('toggle-sidebar'), onSelect: () => setSidebarShowed((v) => !v) },
    ...(encryptionEnabled ? [{
      id: 'lock', label: t('APP_LOCK') || 'Lock App', icon: <BsLock size={14} />,
      shortcut: getShortcutDisplay('lock'), onSelect: async () => { await lockDb(); setIsLocked(true); }
    }] : []),
    { id: 'show-file-location', label: t('APP_SHOW_FILE_LOCATION') || 'Show File Location', icon: <BsFolderSymlink size={14} />,
      onSelect: async () => {
        const { activeTabPath: path, storageBackend } = useAppStore.getState();
        if (!path || isWeb) return;
        if (storageBackend !== 'filesystem') { reactToast.info(t('APP_SHOW_FILE_LOCATION_DB')); return; }
        await revealItemInDir(path);
      } },
    { id: 'export-print', label: t('APP_EXPORT_PRINT') || 'Export and Print', icon: <BsPrinter size={14} />,
      onSelect: () => window.dispatchEvent(new CustomEvent('open-export-modal')) },
    { id: 'toggle-favorite', label: t('APP_TOGGLE_FAVORITE') || 'Toggle Favorite', icon: <BsStarFill size={14} />,
      onSelect: () => {
        const { activeTabPath: path, tabs: allTabs } = useAppStore.getState();
        const tab = allTabs.find((t) => t.file_path === path);
        if (!tab) return;
        const file: FileType = { file_path: tab.file_path, file_name: tab.file_name, file_text: '', is_file: true, is_dir: false };
        const isFav = useAppStore.getState().isFavourite(file);
        useAppStore.getState().setFavourites((list) => setFavouriteItem(list, file, !isFav));
      } },
    { id: 'close-other-tabs', label: t('TAB_CLOSE_OTHERS') || 'Close Others', icon: <BsXCircle size={14} />,
      onSelect: () => { const { tabs: allTabs, activeTabPath: atp, closeTab: ct } = useAppStore.getState(); allTabs.filter((tab) => tab.file_path !== atp).forEach((tab) => ct(tab.file_path)); } },
    { id: 'close-all-tabs', label: t('APP_CLOSE_ALL_TABS') || 'Close All Tabs', icon: <BsXCircle size={14} />,
      onSelect: () => { const { tabs: allTabs, closeTab: ct } = useAppStore.getState(); allTabs.forEach((tab) => ct(tab.file_path)); } },
    { id: 'whats-new', label: t('APP_MAIN_WHATS_NEW') || "What's New", icon: <BsBoxArrowUpRight size={14} />,
      onSelect: () => setNewsModalOpened(true) },
    { id: 'feedback', label: t('APP_MAIN_FEEDBACK') || 'Feedback', icon: <BsBoxArrowUpRight size={14} />,
      onSelect: () => setFeedbackModalOpened(true) },
  ], [encryptionEnabled]);

  return (
    <div className="flex">
      <QuickSwitcherModal
        isOpen={quickSwitcherOpened}
        onClose={() => setQuickSwitcherOpened(false)}
        onFileSelect={onFileSelect}
        commands={quickSwitcherCommands}
      />

      <div
        className={`sidebar fixed h-screen flex flex-col overflow-hidden ${sidebarShowed ? '' : 'sidebar-collapsed'}`}
        style={{ width: sidebarWidth }}
      >
        <div className="flex-shrink-0">
          <AppModeTabs
            modeTab={modeTab}
            onChange={(newMode) => setModeTab(newMode)}
            onCollapse={() => setSidebarShowed(false)}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {modeTab === ModeTab.SEARCH ? (
            <div className="p-4">
              <AppSearchPanel />
            </div>
          ) : (
            <AppFileList onFileSelect={onFileSelect} onFolderSelect={onFolderSelect} modeTab={modeTab} />
          )}
        </div>

        <div className="sidebar-footer flex-shrink-0">
          <Tooltip content={t('APP_MAIN_SETTINGS')}>
            <span className="sidebar-footer-item" onClick={() => setSettingModalOpened(true)}>
              <BsGear size={16} />
            </span>
          </Tooltip>
          <span className="sidebar-footer-item" onClick={() => setNewsModalOpened(true)}>
            {t('APP_MAIN_WHATS_NEW')}
          </span>
          <span className="sidebar-footer-item" onClick={() => setFeedbackModalOpened(true)}>
            {t('APP_MAIN_FEEDBACK')}
          </span>
          <Tooltip content={t('APP_MAIN_USER_GUIDE')}>
            <a href={getUserGuideUrl(lang)} target="_blank" rel="noopener" className="sidebar-footer-item">
              <AiOutlineQuestionCircle size={16} />
            </a>
          </Tooltip>
        </div>
        <NewsModal isOpen={newsModalOpened} onClose={() => setNewsModalOpened(false)} />
        <FeedbackModal isOpen={feedbackModalOpened} onClose={() => setFeedbackModalOpened(false)} />
        {settingModalOpened && (
          <Suspense fallback={null}>
            <SettingModal isOpen={true} onClose={() => setSettingModalOpened(false)} />
          </Suspense>
        )}

        {/* Drag-to-resize handle */}
        <div
          className="sidebar-resize-handle"
          onPointerDown={onResizeStart}
        />
      </div>

      <RawMdPanel
        visible={rawPanelVisible}
        onClose={() => setRawPanelVisible(false)}
        onSaved={() => setRawSaveVersion((v) => v + 1)}
        content={activeTab?.content ?? null}
        filePath={activeTab?.file_path ?? null}
      />

      <div
        className="flex flex-col h-screen overflow-x-hidden overflow-y-auto"
        style={{
          marginLeft: sidebarShowed ? sidebarWidth : 0,
          width: sidebarShowed ? `calc(100% - ${sidebarWidth}px)` : '100%',
          transition: isDragging ? 'none' : 'margin-left 0.15s cubic-bezier(0.4, 0, 0.2, 1), width 0.15s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        <div className="sticky top-0 z-10 flex items-stretch">
          {!sidebarShowed && (
            <button
              className="tab-item tab-sidebar-toggle"
              onClick={() => setSidebarShowed(true)}
              title={t('APP_SHOW_SIDEBAR')}
            >
              <BsArrowBarRight size={14} />
            </button>
          )}
          <TabBar />
        </div>
        <AppEditorPanel
          className="flex-1 min-h-0"
          isLoading={isLoading}
          content={activeTab?.content ?? null}
          editorKey={rawSaveVersion}
          onRenameFile={(newFileName) => {
            if (newFileName && activeTab) {
              const oldFile: FileType = {
                file_path: activeTab.file_path,
                file_name: activeTab.file_name,
                file_text: '',
                is_file: true,
                is_dir: false
              };
              renameFile(oldFile, newFileName);
              const parentPath = extractParentPath(activeTab.file_path);
              const newPath = parentPath ? `${parentPath}/${newFileName}` : newFileName;
              renameTabAction(activeTab.file_path, newPath, newFileName);
              setRefreshFolder(true);
            }
          }}
          onFileSelect={onFileSelect}
        />
      </div>
    </div>
  );
};
