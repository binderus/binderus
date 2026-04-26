import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createFolder, deleteDir, duplicateItem, newFile, getPath, renameFile, moveFiles, readDirectoryCached, invalidateDirCache, invalidateReadCache } from '../../utils/tauri-utils';
import { isWeb, extractParentPath } from '../../utils/base-utils';
import { mockReadDirectory } from '../../utils/mock-data';
import { FileType } from '../../types';
import { useAppContext } from '../../hooks/use-app-context';
import { useAppStore } from '../../hooks/use-app-store';
import { FiMoreVertical } from 'react-icons/fi';
import { ModeTab } from '../app-mode-tabs/app-mode-tabs';
import { Popover } from '@headlessui/react';
import AppFolderHeader from './app-folder-header';
import FolderTreeModal from '../modal/folder-tree-modal';
import SidebarTree from './sidebar-tree';
import {
  addItemtoRecentList,
  isEmptyInitially,
  isGlobalShortcut,
  normalizeFileName,
  setFavouriteItem,
  t
} from '../../utils/base-utils';
import { BsStarFill, BsStack } from 'react-icons/bs';
import { debounce } from '../../utils/base-utils';

interface Props {
  onFileSelect: (item: FileType | null) => void;
  onFolderSelect: (item: FileType | null) => void;
  modeTab?: string;
}

export default ({ onFileSelect, onFolderSelect, modeTab }: Props) => {
  const [files, setFiles] = useState<FileType[]>([]);
  const [folder, setFolder] = useState<FileType | null>(null);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const activeFileRef = useRef<HTMLLIElement>(null);
  const {
    refreshFolder,
    setRefreshFolder,
    recentList,
    setRecentList,
    folderStack,
    setFolderStack,
    setDeletingItem,
    dataDir,
    favourites,
    isFavourite,
    setFavourites
  } = useAppContext();

  const activeTabPath = useAppStore((s) => s.activeTabPath);
  const renameTab = useAppStore((s) => s.renameTab);
  const sidebarView = useAppStore((s) => s.sidebarView);

  const [hoveringId, setHoveringId] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [renamingItem, setRenamingItem] = useState<FileType | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Multi-select: Cmd/Ctrl+Click toggles items; "Move" on any selected item moves all
  const [selectedItems, setSelectedItems] = useState<FileType[]>([]);
  // Move state — list of items to move, opens folder picker when non-empty
  const [moveItems, setMoveItems] = useState<FileType[]>([]);
  const [rootPath, setRootPath] = useState('');
  // Inline "New File/Folder" inside folder three-dot menu
  const [addInFolder, setAddInFolder] = useState<{ path: string; mode: 'file' | 'folder' } | null>(null);
  const [addName, setAddName] = useState('');

  // Resolve absolute root path once on mount (used by SidebarTree and move modal)
  useEffect(() => {
    if (!isWeb) getPath('', true).then(setRootPath);
  }, [dataDir]);

  // Clear selection when navigating folders or switching tabs
  useEffect(() => { setSelectedItems([]); }, [folder, modeTab]);

  useEffect(() => {
    setSearch('');
    if (modeTab === ModeTab.RECENT) {
      setFiles(recentList.filter((obj) => obj.is_file));
    } else if (modeTab === ModeTab.FAVORITES) {
      setFiles(favourites.filter((obj) => obj.is_file));
    } else {
      setFiles([]);
      readDir();
    }
  }, [modeTab, dataDir]);

  useEffect(() => {
    if (modeTab === ModeTab.ALL) {
      readDir();
    }
  }, [folder]);

  useEffect(() => {
    if (refreshFolder) {
      readDir();
      setRefreshFolder ? setRefreshFolder(false) : '';
    }
  }, [refreshFolder]);

  // Sync local folder state when folderStack is changed externally (e.g. tab→sidebar navigation)
  useEffect(() => {
    const newFolder = folderStack.length > 0 ? folderStack[folderStack.length - 1] : null;
    const currentPath = folder?.file_path ?? null;
    const newPath = newFolder?.file_path ?? null;
    if (currentPath !== newPath) {
      setFolder(newFolder);
    }
  }, [folderStack]);

  // Scroll active file into view when active tab changes
  useEffect(() => {
    requestAnimationFrame(() => {
      if (activeFileRef.current) {
        activeFileRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }, [activeTabPath, files]);

  const readDir = async () => {
    if (isWeb) {
      const res = mockReadDirectory();
      setFiles((res?.files as FileType[]) ?? []);
      return res?.files ?? [];
    }

    const dirPath = folder ? folder?.file_path : await getPath('', true);
    const res = await readDirectoryCached(dirPath);
    setFiles((res?.files as FileType[]) ?? []);
    return res?.files ?? [];
  };

  const toggleSelect = (item: FileType) => {
    setSelectedItems((prev) => {
      const exists = prev.some((i) => i.file_path === item.file_path);
      return exists ? prev.filter((i) => i.file_path !== item.file_path) : [...prev, item];
    });
  };

  const isSelected = (item: FileType) => selectedItems.some((i) => i.file_path === item.file_path);

  const onClickFolder = (item: FileType) => {
    setFolder(item);
    setFolderStack((stack) => [...stack, item]);
    setRecentList((list) => addItemtoRecentList(list, item));
  };

  const onClickFile = (item: FileType) => {
    onFileSelect(item);
    setSelectedIndex(-1);
  };

  const deleteItem = async (e: React.MouseEvent<HTMLButtonElement, MouseEvent>, item: FileType) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isWeb) {
      if (item.is_dir) {
        await deleteDir(item.file_path);
      } else {
        await invoke('delete_file', { filePath: item.file_path });
        // Parent dir listing shrank; drop the file's own read-cache entry
        // Match trailing separator across both '/' and '\' for Windows compat
        const sepIdx = Math.max(item.file_path.lastIndexOf('/'), item.file_path.lastIndexOf('\\'));
        if (sepIdx > 0) invalidateDirCache(item.file_path.slice(0, sepIdx));
        invalidateReadCache(item.file_path);
      }
    }
    // Remove deleted item from favourites (if present)
    setFavourites((list) => list.filter((fav) => fav.file_path !== item.file_path));
    readDir();
    setDeletingItem(item);
  };

  const startRename = (item: FileType) => {
    setRenamingItem(item);
    setRenameValue(item.file_name);
  };

  const submitRename = async () => {
    if (!renamingItem || !renameValue.trim() || renameValue === renamingItem.file_name) {
      setRenamingItem(null);
      return;
    }
    const newName = renameValue.trim();
    if (!isWeb) {
      await renameFile(renamingItem, newName);
    }
    // Compute new path (parent stays, basename swaps) and sync open tabs.
    // Folder rename cascades to every tab whose path lives under the old folder.
    const oldPath = renamingItem.file_path;
    const sep = oldPath.includes('\\') ? '\\' : '/';
    const parent = extractParentPath(oldPath);
    const newPath = parent ? `${parent}${sep}${newName}` : newName;
    if (renamingItem.is_dir) {
      const oldPrefix = `${oldPath}${sep}`;
      const newPrefix = `${newPath}${sep}`;
      const tabs = useAppStore.getState().tabs;
      for (const tab of tabs) {
        if (tab.file_path.startsWith(oldPrefix)) {
          const tail = tab.file_path.slice(oldPrefix.length);
          renameTab(tab.file_path, `${newPrefix}${tail}`, tab.file_name);
        }
      }
    } else {
      renameTab(oldPath, newPath, newName);
    }
    setRenamingItem(null);
    readDir();
  };

  // If the triggered item is part of the current selection, move all selected items.
  // Otherwise move only the triggered item (ignoring the selection).
  const openMoveModal = async (item: FileType) => {
    const root = await getPath('', true);
    setRootPath(root);
    const items = isSelected(item) && selectedItems.length > 1 ? selectedItems : [item];
    setMoveItems(items);
  };

  const onDuplicate = async (item: FileType) => {
    const newPath = await duplicateItem(item);
    if (newPath) {
      setRefreshFolder ? setRefreshFolder(true) : '';
      readDir();
    }
  };

  const handleMoveConfirm = async (destPath: string) => {
    if (moveItems.length === 0) return;
    if (!isWeb) {
      await moveFiles(moveItems.map((i) => i.file_path), destPath);
    }
    const newPathOf = (item: FileType): string => {
      const sep = item.file_path.includes('\\') ? '\\' : '/';
      return destPath + sep + item.file_name;
    };
    // Update favourites: replace old paths with new paths for moved items.
    setFavourites((list) => list.map((fav) => {
      const moved = moveItems.find((i) => i.file_path === fav.file_path);
      if (!moved) return fav;
      return { ...fav, file_path: newPathOf(moved) };
    }));
    // Keep open tabs' file_path in sync with the move; `renameTab` also
    // updates `activeTabPath` when the active tab is one of the moved items.
    for (const item of moveItems) {
      renameTab(item.file_path, newPathOf(item), item.file_name);
    }
    setMoveItems([]);
    setSelectedItems([]);
    readDir();
  };

  const onNewFile = async (newFileName: string) => {
    if (newFileName) {
      await newFile(folder?.file_path ?? '', normalizeFileName(newFileName));
      setRefreshFolder(true);
      const newFiles = await readDir();

      const newlyCreatedFile = newFiles.find((obj) => obj.file_path.indexOf('/' + newFileName) >= 0);
      newlyCreatedFile ? onClickFile(newlyCreatedFile) : '';
    }
  };

  const onNewFolder = async (newFolder: string) => {
    if (newFolder) {
      await createFolder(folder?.file_path || '', normalizeFileName(newFolder));
      setRefreshFolder(true);
      readDir();
    }
  };

  const onNewFileInFolder = async (parentPath: string, fileName: string) => {
    if (fileName) {
      await newFile(parentPath, normalizeFileName(fileName));
      setRefreshFolder(true);
      readDir();
    }
  };

  const onNewFolderInFolder = async (parentPath: string, folderName: string) => {
    if (folderName) {
      await createFolder(parentPath, normalizeFileName(folderName));
      setRefreshFolder(true);
      readDir();
    }
  };

  const folderBackClicked = async () => {
    setFolderStack((stack) => {
      stack.pop();
      const lastFolder = stack[stack.length - 1];
      setFolder(lastFolder);
      onFolderSelect(lastFolder);
      return stack;
    });
  };

  const folderRootClicked = async () => {
    if (BsStack.length === 0) {
      return;
    }
    setFolderStack((stack) => {
      setFolder(null);
      onFolderSelect(null);
      return [];
    });
  };

  const searchChanged = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = `${e.target.value}`.toLowerCase();
    setSearch(text);
    setSelectedIndex(-1);
  };
  const searchChangedDebounced = debounce(searchChanged, 250);

  const searchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isGlobalShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      filterInputRef.current?.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((idx) => (idx < sortedFiles.length - 1 ? idx + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((idx) => (idx > 0 ? idx - 1 : sortedFiles.length - 1));
    } else if (e.key === 'Enter') {
      onClickFile(sortedFiles[selectedIndex]);
    }
  };

  // Derived lists — memoized so hover/focus/selection ticks don't re-filter+sort
  // the whole vault listing on every render. Both depend only on files (+ search
  // for sortedFiles); no other upstream changes should rebuild them.
  const folders = useMemo(
    () => [...files]
      .filter((file) => file.is_dir && !file.file_name.startsWith('.'))
      .sort((a, b) => a.file_name.localeCompare(b.file_name)),
    [files]
  );

  const sortedFiles = useMemo(() => {
    const base = [...files]
      .filter((file) => !file.is_dir && !file.file_name.startsWith('.'))
      .sort((a, b) => a.file_name.localeCompare(b.file_name));
    if (!search) return base;
    return base.filter((obj) => obj.file_name.toLowerCase().indexOf(search) >= 0);
  }, [files, search]);

  // Tree view: show SidebarTree for ALL tab, fall back to flat list for others
  if (modeTab === ModeTab.ALL && sidebarView === 'tree') {
    return (
      <div>
        <SidebarTree rootPath={rootPath || dataDir} onFileSelect={onClickFile}
          onNewFile={onNewFile} onNewFolder={onNewFolder} />
      </div>
    );
  }

  return (
    <div>
      <div>
        {modeTab === ModeTab.RECENT ? (
          <div className="sidebar-dir-name px-4 pt-3">{t('APP_MAIN_TAB_RECENT')}</div>
        ) : modeTab === ModeTab.FAVORITES ? (
          <div className="sidebar-dir-name px-4 pt-3">{t('APP_MAIN_TAB_FAVORITES')}</div>
        ) : (
          <AppFolderHeader
            folder={folder}
            onClickBack={folderBackClicked}
            onClickRoot={folderRootClicked}
            onNewFolder={onNewFolder}
            onNewFile={onNewFile}
          />
        )}
      </div>

      {/* Selection indicator */}
      {selectedItems.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1 text-xs text-gray-400">
          <span>{selectedItems.length} selected</span>
          <button className="underline hover:text-white" onClick={() => setSelectedItems([])}>
            clear
          </button>
        </div>
      )}

      <ul className="pt-2">
        {modeTab === ModeTab.ALL
          ? folders.map((item) => {
              const name = item?.file_name;
              if (!item || !item?.file_name) {
                return;
              }
              const itemSelected = isSelected(item);
              return (
                <li
                  key={name}
                  className={`sidebar-folder ${itemSelected ? 'sidebar-file-active' : ''}`}
                  onClick={(e) => {
                    if (renamingItem?.file_path === item.file_path) return;
                    if (e.metaKey || e.ctrlKey) {
                      toggleSelect(item);
                      return;
                    }
                    setSelectedItems([]);
                    onClickFolder(item);
                    onFolderSelect(item);
                  }}
                  onMouseOver={() => setHoveringId(item.file_path)}
                  onMouseOut={() => setHoveringId('')}
                >
                  {renamingItem?.file_path === item.file_path ? (
                    <input
                      className="flex-1 bg-transparent text-white text-sm outline-none border-b border-gray-500 py-0 px-0"
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') submitRename();
                        if (e.key === 'Escape') setRenamingItem(null);
                      }}
                      onBlur={() => submitRename()}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="flex items-center flex-1 min-w-0">
                      <span className="flex-1 truncate">{name}</span>
                      {modeTab === ModeTab.ALL && hoveringId === item.file_path && (
                        <Popover className="relative">
                          {({ open, close }) => (
                            <>
                              <Popover.Button
                                as="button"
                                className="ml-1 mr-2 icon-btn flex items-center"
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  setConfirmDeleteId('');
                                  setAddInFolder(null); setAddName('');
                                }}
                              >
                                <FiMoreVertical size={16} />
                              </Popover.Button>
                              {open && (
                                <Popover.Panel className="absolute right-0 z-10 mt-1 w-44" static>
                                  <div className="popover-panel py-1">
                                    {addInFolder?.path === item.file_path ? (
                                      <div className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                                        <input
                                          autoFocus
                                          className="input-dark w-full"
                                          placeholder={addInFolder.mode === 'file' ? t('APP_MAIN_NEW_FILE_PLACEHOLDER') : t('APP_MAIN_NEW_FOLDER_PLACEHOLDER')}
                                          value={addName}
                                          autoComplete="off"
                                          autoCorrect="off"
                                          autoCapitalize="off"
                                          onChange={(e) => setAddName(e.target.value)}
                                          onKeyUp={(e) => {
                                            if (e.key === 'Enter' && addName.trim()) {
                                              if (addInFolder.mode === 'file') onNewFileInFolder(item.file_path, addName.trim());
                                              else onNewFolderInFolder(item.file_path, addName.trim());
                                              setAddInFolder(null); setAddName(''); close();
                                            }
                                            if (e.key === 'Escape') { setAddInFolder(null); setAddName(''); close(); }
                                          }}
                                        />
                                        <button className="btn btn-primary mt-2 w-full" onClick={() => {
                                          if (addName.trim()) {
                                            if (addInFolder.mode === 'file') onNewFileInFolder(item.file_path, addName.trim());
                                            else onNewFolderInFolder(item.file_path, addName.trim());
                                          }
                                          setAddInFolder(null); setAddName(''); close();
                                        }}>
                                          {addInFolder.mode === 'file' ? t('APP_MAIN_NEW_FILE') : t('APP_MAIN_NEW_FOLDER')}
                                        </button>
                                      </div>
                                    ) : (
                                    <>
                                    <button
                                      className="menu-item"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAddInFolder({ path: item.file_path, mode: 'file' }); setAddName('');
                                      }}
                                    >
                                      {t('APP_MAIN_NEW_FILE')}
                                    </button>
                                    <button
                                      className="menu-item"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAddInFolder({ path: item.file_path, mode: 'folder' }); setAddName('');
                                      }}
                                    >
                                      {t('APP_MAIN_NEW_FOLDER')}
                                    </button>
                                    <hr className="border-gray-600 my-1" />
                                    <button
                                      className="menu-item"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        startRename(item);
                                        close();
                                      }}
                                    >
                                      {t('TEXT_RENAME_FILE')}
                                    </button>
                                    <button
                                      className="menu-item"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openMoveModal(item);
                                        close();
                                      }}
                                    >
                                      {isSelected(item) && selectedItems.length > 1
                                        ? `${t('TEXT_MOVE')} (${selectedItems.length})`
                                        : t('TEXT_MOVE')}
                                    </button>
                                    <button
                                      className="menu-item"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onDuplicate(item);
                                        close();
                                      }}
                                    >
                                      {t('TEXT_DUPLICATE')}
                                    </button>
                                    {confirmDeleteId === item.file_path ? (
                                      <button
                                        className="btn btn-danger"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          deleteItem(e, item);
                                          close();
                                          setConfirmDeleteId('');
                                        }}
                                      >
                                        {t('TEXT_CONFIRM_DELETE')}
                                      </button>
                                    ) : (
                                      <button
                                        className="menu-item"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setConfirmDeleteId(item.file_path);
                                        }}
                                      >
                                        {t('TEXT_DELETE')}
                                      </button>
                                    )}
                                    </>
                                    )}
                                  </div>
                                </Popover.Panel>
                              )}
                            </>
                          )}
                        </Popover>
                      )}
                    </div>
                  )}
                </li>
              );
            })
          : null}

        {modeTab === ModeTab.FAVORITES && (
          <div className="ml-4 mb-2">
            <input
              ref={filterInputRef}
              className="p-1 w-64 bg-black text-white text-sm"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              onChange={searchChangedDebounced}
              onKeyDown={searchInputKeyDown}
            />
          </div>
        )}

        {isEmptyInitially(files) && <div className="text-gray-600 ml-4 mt-2 text-sm">{t('APP_MAIN_NO_FILES')}</div>}

        {sortedFiles.map((item, idx) => {
          if (item?.is_dir) {
            return;
          }
          if (item.is_file && item.file_name.split('.')[0] === '') {
            return;
          }
          const name = item.file_name.replace(/.md/gi, '').replace(/.txt/gi, '');
          const isActiveFile = activeTabPath === item.file_path;
          const itemSelected = isSelected(item);
          const favClicked = () => {
            if (item) {
              const isFav = isFavourite(item);
              if (isFav === true) {
                setFavourites((list) => setFavouriteItem(list, item, false));
              } else {
                setFavourites((list) => setFavouriteItem(list, item, true));
              }
            }
          };
          return (
            <li
              key={name}
              ref={isActiveFile ? activeFileRef : undefined}
              className={`sidebar-file ${
                isActiveFile || (modeTab === ModeTab.FAVORITES && selectedIndex === idx)
                  ? 'sidebar-file-active'
                  : itemSelected
                  ? 'sidebar-file-active'
                  : ''
              }`}
              onClick={(e) => {
                if (renamingItem?.file_path === item.file_path) return;
                if (e.metaKey || e.ctrlKey) {
                  toggleSelect(item);
                  return;
                }
                setSelectedItems([]);
                onClickFile(item);
              }}
              onMouseOver={() => setHoveringId(item.file_path)}
              onMouseOut={() => setHoveringId('')}
            >
              {renamingItem?.file_path === item.file_path ? (
                <input
                  className="flex-1 bg-transparent text-white text-sm outline-none border-b border-gray-500 py-0 px-0"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') submitRename();
                    if (e.key === 'Escape') setRenamingItem(null);
                  }}
                  onBlur={() => submitRename()}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <div className="flex items-center flex-1 min-w-0">
                  <span className="flex-1 truncate">
                    {name}{' '}
                    {isFavourite(item) && (
                      <BsStarFill className="inline ml-1 text-gray-600 hover:text-blue-500 cursor-pointer" onClick={favClicked} />
                    )}
                  </span>
                  {modeTab === ModeTab.ALL && hoveringId === item.file_path && (
                    <Popover className="relative">
                      {({ open, close }) => (
                        <>
                          <Popover.Button
                            as="button"
                            className="ml-1 mr-2 icon-btn flex items-center"
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              setConfirmDeleteId('');
                            }}
                          >
                            <FiMoreVertical size={16} />
                          </Popover.Button>
                          {open && (
                            <Popover.Panel className="absolute right-0 z-10 mt-1 w-36" static>
                              <div className="popover-panel py-1">
                                <button
                                  className="menu-item"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startRename(item);
                                    close();
                                  }}
                                >
                                  {t('TEXT_RENAME_FILE')}
                                </button>
                                <button
                                  className="menu-item"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openMoveModal(item);
                                    close();
                                  }}
                                >
                                  {isSelected(item) && selectedItems.length > 1
                                    ? `${t('TEXT_MOVE')} (${selectedItems.length})`
                                    : t('TEXT_MOVE')}
                                </button>
                                <button
                                  className="menu-item"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDuplicate(item);
                                    close();
                                  }}
                                >
                                  {t('TEXT_DUPLICATE')}
                                </button>
                                {confirmDeleteId === item.file_path ? (
                                  <button
                                    className="btn btn-danger"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteItem(e, item);
                                      close();
                                      setConfirmDeleteId('');
                                    }}
                                  >
                                    {t('TEXT_CONFIRM_DELETE')}
                                  </button>
                                ) : (
                                  <button
                                    className="menu-item"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmDeleteId(item.file_path);
                                    }}
                                  >
                                    {t('TEXT_DELETE')}
                                  </button>
                                )}
                              </div>
                            </Popover.Panel>
                          )}
                        </>
                      )}
                    </Popover>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <FolderTreeModal
        isOpen={moveItems.length > 0}
        rootPath={rootPath}
        onSelect={handleMoveConfirm}
        onClose={() => setMoveItems([])}
      />
    </div>
  );
};
