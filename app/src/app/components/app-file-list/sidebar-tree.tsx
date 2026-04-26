// Description: Inline expandable tree-view for the sidebar. Shows both files and folders
//   starting from the data root, loading children lazily on expand. Supports hover menus
//   (rename, move, delete), Cmd/Ctrl+Click multi-select, and active-file highlighting.
//   Large vaults are handled via row virtualization (@tanstack/react-virtual) over a
//   flattened list of currently-visible rows — only ~30–40 DOM nodes live at once,
//   independent of total vault size.
// Requirements: Tauri invoke (read_directory), FolderTreeModal, react-icons, @tanstack/react-virtual
// Inputs: rootPath, onFileSelect, activeTabPath
// Outputs: Renders a navigable tree; calls onFileSelect when a file is clicked

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiChevronRight, FiChevronDown, FiMoreVertical, FiPlus, FiX } from 'react-icons/fi';
import { BsStarFill } from 'react-icons/bs';
import { Popover } from '@headlessui/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileType } from '../../types';
import { dedupeFolderName, extractParentPath, isWeb, normalizeFileName, stripZipExtension, t } from '../../utils/base-utils';
import { mockReadDirectory } from '../../utils/mock-data';
import { invoke } from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { deleteDir, duplicateItem, renameFile, moveFiles, getPath, newFile, createFolder, readDirectoryCached, invalidateDirCache, invalidateReadCache, importZipToVault, type ImportZipError, type ImportZipResult } from '../../utils/tauri-utils';
import { log } from '../../utils/log';
import { showAlert } from '../confirm-dialog/confirm-dialog';
import { useAppContext } from '../../hooks/use-app-context';

/**
 * Portals a hover-row's kebab popover to <body> so it escapes the sidebar's
 * `overflow:auto` scroll container (otherwise the menu gets clipped at the
 * sidebar's right edge — see issue from screenshot 2026-04-25).
 *
 * Positioning: `position: fixed` anchored to the trigger button's bounding rect.
 * The trigger is the most-recently-rendered `.row-kebab-anchor` button, which is
 * always the parent of the open Popover (Headless UI guarantees this).
 *
 * Edge handling: clamp horizontally to the viewport so the menu never overflows
 * the right edge on narrow windows; flip above the trigger if there isn't room
 * below.
 */
const PortaledKebabPanel = ({ children }: { children: React.ReactNode }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    // The Popover.Button rendered just before us carries .row-kebab-anchor;
    // the latest in document order is the open one (only one popover open at a time).
    const anchors = document.querySelectorAll<HTMLButtonElement>('.row-kebab-anchor');
    const anchor = anchors[anchors.length - 1];
    if (!anchor) return;

    const compute = () => {
      const rect = anchor.getBoundingClientRect();
      const panel = wrapperRef.current;
      const w = panel?.offsetWidth ?? 176;
      const h = panel?.offsetHeight ?? 200;

      // Default: drop below the trigger, right-aligned.
      let top = rect.bottom + 4;
      let left = rect.right - w;

      // Clamp horizontally with an 8px gutter.
      const gutter = 8;
      if (left < gutter) left = gutter;
      if (left + w > window.innerWidth - gutter) left = window.innerWidth - w - gutter;

      // Flip above if not enough room below.
      if (top + h > window.innerHeight - gutter) {
        top = Math.max(gutter, rect.top - h - 4);
      }

      setPos({ top, left });
    };

    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, []);

  return createPortal(
    <div
      ref={wrapperRef}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        zIndex: 1000,
        // Hide until first measurement to avoid a flash at the top-left corner.
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body
  );
};
import { useAppStore } from '../../hooks/use-app-store';
import FolderTreeModal from '../modal/folder-tree-modal';
import { setFavouriteItem } from '../../utils/base-utils';

interface Props {
  rootPath: string;
  onFileSelect: (item: FileType) => void;
  onNewFile?: (name: string) => void;
  onNewFolder?: (name: string) => void;
}

interface TreeNode {
  item: FileType;
  children: TreeNode[] | null; // null = not yet loaded
  expanded: boolean;
}

async function loadChildren(dirPath: string): Promise<TreeNode[]> {
  let files: FileType[] = [];
  if (isWeb) {
    const res = mockReadDirectory();
    files = (res?.files as FileType[]) ?? [];
  } else {
    const res = await readDirectoryCached(dirPath);
    files = (res?.files as FileType[]) ?? [];
  }
  // Folders first, then files, both alphabetical; hide dotfiles
  const dirs = files.filter((f) => f.is_dir && !f.file_name.startsWith('.')).sort((a, b) => a.file_name.localeCompare(b.file_name));
  const fileItems = files.filter((f) => f.is_file && !f.file_name.startsWith('.')).sort((a, b) => a.file_name.localeCompare(b.file_name));
  return [...dirs, ...fileItems].map((item) => ({ item, children: item.is_dir ? null : [], expanded: false }));
}

async function updateNode(nodes: TreeNode[], path: string, updater: (node: TreeNode) => TreeNode): Promise<TreeNode[]> {
  return Promise.all(
    nodes.map(async (node) => {
      if (node.item.file_path === path) return updater(node);
      if (node.children && node.children.length > 0) {
        return { ...node, children: await updateNode(node.children, path, updater) };
      }
      return node;
    })
  );
}

// Memo-wrapped so non-prop changes in the parent (selection toggles, etc.)
// don't cascade into every virtualized row. React Compiler memoizes JSX inside
// each call but not the component boundary itself — memo closes that gap.
const TreeNodeItem = memo(function TreeNodeItem({
  node,
  depth,
  activeTabPath,
  selectedPaths,
  hoveringId,
  confirmDeleteId,
  renamingItem,
  renameValue,
  onToggle,
  onFileClick,
  onSelect,
  onRenameStart,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onDeleteConfirmSet,
  onDelete,
  onMoveOpen,
  onDuplicate,
  onHover,
  onFavToggle,
  isFavourite,
  onNewFile,
  onNewFolder,
  addInFolder,
  addName,
  onAddModeSet,
  onAddNameChange,
  onAddConfirm,
  onAddCancel,
}: {
  node: TreeNode;
  depth: number;
  activeTabPath: string | null;
  selectedPaths: Set<string>;
  hoveringId: string;
  confirmDeleteId: string;
  renamingItem: FileType | null;
  renameValue: string;
  onToggle: (path: string) => void;
  onFileClick: (item: FileType, e: React.MouseEvent) => void;
  onSelect: (item: FileType, e: React.MouseEvent) => void;
  onRenameStart: (item: FileType) => void;
  onRenameChange: (val: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onDeleteConfirmSet: (path: string) => void;
  onDelete: (item: FileType) => void;
  onMoveOpen: (item: FileType) => void;
  onDuplicate: (item: FileType) => void;
  onHover: (path: string) => void;
  onFavToggle: (item: FileType) => void;
  isFavourite: (item: FileType | null) => boolean;
  onNewFile: (parentPath: string, name: string) => void;
  onNewFolder: (parentPath: string, name: string) => void;
  addInFolder: { path: string; mode: 'file' | 'folder' } | null;
  addName: string;
  onAddModeSet: (path: string, mode: 'file' | 'folder') => void;
  onAddNameChange: (val: string) => void;
  onAddConfirm: (close: () => void) => void;
  onAddCancel: (close: () => void) => void;
}) {
  const { item } = node;
  const isActive = activeTabPath === item.file_path;
  const isSelected = selectedPaths.has(item.file_path);
  const isRenaming = renamingItem?.file_path === item.file_path;
  const displayName = item.is_file
    ? item.file_name.replace(/\.(md|txt)$/i, '')
    : item.file_name;
  const indent = depth * 14;

  // Note: scroll-into-view for active file is now handled upstream via
  // virtualizer.scrollToIndex, since an unmounted virtualized row has no ref.

  return (
    <div>
      <div
        className={`flex items-center cursor-pointer text-sm py-0.5 pr-1 rounded select-none
          ${item.is_file
            ? isActive || isSelected ? 'sidebar-file-active' : 'sidebar-file'
            : isSelected ? 'sidebar-file-active' : 'sidebar-folder'
          }`}
        style={{ paddingLeft: `${indent + 4}px` }}
        onClick={(e) => {
          if (isRenaming) return;
          if (item.is_dir) {
            if (e.metaKey || e.ctrlKey) { onSelect(item, e); return; }
            onToggle(item.file_path);
          } else {
            onFileClick(item, e);
          }
        }}
        onMouseOver={() => onHover(item.file_path)}
        onMouseOut={() => onHover('')}
      >
        {/* Expand/collapse chevron for folders */}
        {item.is_dir ? (
          <span className="mr-1 flex-shrink-0 w-3">
            {node.expanded ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
          </span>
        ) : (
          <span className="mr-1 flex-shrink-0 w-3" />
        )}

        {/* Name or rename input */}
        {isRenaming ? (
          <input
            className="flex-1 bg-transparent text-white text-sm outline-none border-b border-gray-500 py-0 px-0"
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') onRenameSubmit();
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={onRenameSubmit}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 truncate">
            {displayName}
            {item.is_file && isFavourite(item) && (
              <BsStarFill
                className="inline ml-1 text-gray-600 hover:text-blue-500 cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onFavToggle(item); }}
              />
            )}
          </span>
        )}

        {/* Three-dot menu on hover */}
        {!isRenaming && hoveringId === item.file_path && (
          <Popover className="relative">
            {({ open, close }) => (
              <>
                <Popover.Button
                  as="button"
                  className="ml-1 mr-2 icon-btn flex items-center flex-shrink-0 row-kebab-anchor"
                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); }}
                >
                  <FiMoreVertical size={14} />
                </Popover.Button>
                {open && (
                  <PortaledKebabPanel>
                    <Popover.Panel className="w-44" static>
                    <div className="popover-panel py-1">
                      {item.is_dir && addInFolder?.path === item.file_path ? (
                        <div className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            autoFocus
                            className="input-dark w-full"
                            placeholder={addInFolder.mode === 'file' ? t('APP_MAIN_NEW_FILE_PLACEHOLDER') : t('APP_MAIN_NEW_FOLDER_PLACEHOLDER')}
                            value={addName}
                            autoComplete="off" autoCorrect="off" autoCapitalize="off"
                            onChange={(e) => onAddNameChange(e.target.value)}
                            onKeyUp={(e) => {
                              if (e.key === 'Enter') onAddConfirm(close);
                              if (e.key === 'Escape') onAddCancel(close);
                            }}
                          />
                          <button className="btn btn-primary mt-2 w-full" onClick={() => onAddConfirm(close)}>
                            {addInFolder.mode === 'file' ? t('APP_MAIN_NEW_FILE') : t('APP_MAIN_NEW_FOLDER')}
                          </button>
                        </div>
                      ) : (
                      <>
                      {item.is_dir && (
                        <>
                          <button className="menu-item" onClick={(e) => {
                            e.stopPropagation();
                            onAddModeSet(item.file_path, 'file');
                          }}>
                            {t('APP_MAIN_NEW_FILE')}
                          </button>
                          <button className="menu-item" onClick={(e) => {
                            e.stopPropagation();
                            onAddModeSet(item.file_path, 'folder');
                          }}>
                            {t('APP_MAIN_NEW_FOLDER')}
                          </button>
                          <hr className="border-gray-600 my-1" />
                        </>
                      )}
                      <button className="menu-item" onClick={(e) => { e.stopPropagation(); onRenameStart(item); close(); }}>
                        {t('TEXT_RENAME_FILE')}
                      </button>
                      <button className="menu-item" onClick={(e) => { e.stopPropagation(); onMoveOpen(item); close(); }}>
                        {selectedPaths.has(item.file_path) && selectedPaths.size > 1
                          ? `${t('TEXT_MOVE')} (${selectedPaths.size})`
                          : t('TEXT_MOVE')}
                      </button>
                      <button className="menu-item" onClick={(e) => { e.stopPropagation(); onDuplicate(item); close(); }}>
                        {t('TEXT_DUPLICATE')}
                      </button>
                      {confirmDeleteId === item.file_path ? (
                        <button className="btn btn-danger" onClick={(e) => { e.stopPropagation(); onDelete(item); close(); }}>
                          {t('TEXT_CONFIRM_DELETE')}
                        </button>
                      ) : (
                        <button className="menu-item" onClick={(e) => { e.stopPropagation(); onDeleteConfirmSet(item.file_path); }}>
                          {t('TEXT_DELETE')}
                        </button>
                      )}
                      </>
                      )}
                    </div>
                    </Popover.Panel>
                  </PortaledKebabPanel>
                )}
              </>
            )}
          </Popover>
        )}
      </div>

      {/* Children are no longer rendered recursively here — the virtualizer in
          SidebarTree walks the flattened visible list and renders each row. */}
    </div>
  );
});

/** Localise an ImportZipError into a human-readable reason string. */
function importZipErrorReason(err: unknown): string {
  if (err && typeof err === 'object' && 'kind' in err) {
    const e = err as ImportZipError;
    switch (e.kind) {
      case 'invalidZip':            return e.reason || 'invalid zip';
      case 'zipSlip':               return `unsafe entry: ${e.path}`;
      case 'bombRatio':             return 'zip-bomb guard triggered';
      case 'tooLarge':              return 'zip exceeds size limit (500 MB)';
      case 'tooManyEntries':        return 'zip exceeds entry limit (50000)';
      case 'encryptedNotSupported': return 'encrypted zips are not supported yet';
      case 'targetExists':          return `target already exists: ${e.path}`;
      case 'emptyZip':              return 'zip is empty';
      case 'cancelled':             return 'cancelled';
      case 'io':                    return e.reason || 'I/O error';
    }
  }
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'unknown error';
}

/** Flatten the tree into a linear list of currently-visible rows with depth info.
 *  Used as input for the virtualizer — a 10k-file vault still yields only as many
 *  rows as are actually expanded + visible. Cheap: pure O(n) walk, no allocations
 *  per render beyond the array itself. */
interface FlatRow { node: TreeNode; depth: number; }
function flattenVisible(nodes: TreeNode[], depth = 0, out: FlatRow[] = []): FlatRow[] {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.item.is_dir && node.expanded && node.children && node.children.length > 0) {
      flattenVisible(node.children, depth + 1, out);
    }
  }
  return out;
}

export default function SidebarTree({ rootPath, onFileSelect, onNewFile, onNewFolder }: Props) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [hoveringId, setHoveringId] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [renamingItem, setRenamingItem] = useState<FileType | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [selectedItems, setSelectedItems] = useState<FileType[]>([]);
  const [moveItems, setMoveItems] = useState<FileType[]>([]);
  const [moveRootPath, setMoveRootPath] = useState('');
  const [addInFolder, setAddInFolder] = useState<{ path: string; mode: 'file' | 'folder' } | null>(null);
  const [addName, setAddName] = useState('');
  // Zip import: two-step flow. `importZipPath` is set after the user picks a
  // file and drives a dedicated FolderTreeModal instance. `importProgress` is
  // set during extraction and drives the inline progress bar above the tree.
  const [importZipPath, setImportZipPath] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; currentFile: string } | null>(null);
  const importRunningRef = useRef(false);

  const activeTabPath = useAppStore((s) => s.activeTabPath);
  const renameTab = useAppStore((s) => s.renameTab);
  const { isFavourite, setFavourites, setDeletingItem } = useAppContext();
  const refreshFolder = useAppStore((s) => s.refreshFolder);
  const setRefreshFolder = useAppStore((s) => s.setRefreshFolder);

  // Stable-identity Set so rows aren't forced to re-render on unrelated state ticks
  const selectedPaths = useMemo(() => new Set(selectedItems.map((i) => i.file_path)), [selectedItems]);

  useEffect(() => {
    loadChildren(rootPath).then(setTree);
  }, [rootPath]);

  // Refresh the tree when an external operation triggers it
  useEffect(() => {
    if (refreshFolder) {
      loadChildren(rootPath).then((fresh) => {
        setTree(fresh);
        // After refresh, reveal the active file if there is one
        const atp = useAppStore.getState().activeTabPath;
        if (atp) revealPath(fresh, atp);
      });
      setRefreshFolder(false);
    }
  }, [refreshFolder]);

  // When the active tab changes, expand ancestor folders to reveal the file
  useEffect(() => {
    if (activeTabPath) revealPath(tree, activeTabPath);
  }, [activeTabPath]);

  /** Expand all ancestor folders for `filePath` in the tree, loading children lazily as needed. */
  const revealPath = async (currentTree: TreeNode[], filePath: string) => {
    const normalizedRoot = rootPath.replace(/\/+$/, '');
    const normalizedFile = filePath.replace(/\\/g, '/');
    if (!normalizedFile.startsWith(normalizedRoot + '/')) return;

    // Collect ancestor directory paths between root and the file
    const ancestors: string[] = [];
    let parent = extractParentPath(normalizedFile).replace(/\\/g, '/');
    while (parent && parent !== normalizedRoot && parent.startsWith(normalizedRoot)) {
      ancestors.unshift(parent);
      parent = extractParentPath(parent).replace(/\\/g, '/');
    }
    if (ancestors.length === 0) return;

    // Expand each ancestor, loading children if needed
    let updated = currentTree;
    for (const dirPath of ancestors) {
      updated = await ensureExpanded(updated, dirPath);
    }
    setTree(updated);
  };

  /** Recursively find the node at `path` and ensure it's expanded with children loaded. */
  const ensureExpanded = async (nodes: TreeNode[], path: string): Promise<TreeNode[]> => {
    return Promise.all(
      nodes.map(async (node) => {
        if (node.item.file_path === path) {
          if (!node.expanded || node.children === null) {
            const children = node.children === null ? await loadChildren(path) : node.children;
            return { ...node, expanded: true, children };
          }
          return node;
        }
        if (node.children && node.children.length > 0) {
          return { ...node, children: await ensureExpanded(node.children, path) };
        }
        return node;
      })
    );
  };

  const handleToggle = async (path: string) => {
    setTree(await updateNode(tree, path, (node) => {
      if (!node.expanded && node.children === null) {
        // Will load children; temporarily mark as expanded with empty array
        loadChildren(path).then((children) => {
          setTree((prev) => updateNodeSync(prev, path, (n) => ({ ...n, children, expanded: true })));
        });
        return { ...node, expanded: true, children: [] };
      }
      return { ...node, expanded: !node.expanded };
    }));
  };

  // Sync version of updateNode (no async)
  const updateNodeSync = (nodes: TreeNode[], path: string, updater: (node: TreeNode) => TreeNode): TreeNode[] => {
    return nodes.map((node) => {
      if (node.item.file_path === path) return updater(node);
      if (node.children && node.children.length > 0) {
        return { ...node, children: updateNodeSync(node.children, path, updater) };
      }
      return node;
    });
  };

  const handleFileClick = (item: FileType, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      toggleSelect(item);
      return;
    }
    setSelectedItems([]);
    onFileSelect(item);
  };

  const handleSelect = (item: FileType, e: React.MouseEvent) => {
    toggleSelect(item);
  };

  const toggleSelect = (item: FileType) => {
    setSelectedItems((prev) => {
      const exists = prev.some((i) => i.file_path === item.file_path);
      return exists ? prev.filter((i) => i.file_path !== item.file_path) : [...prev, item];
    });
  };

  const handleRenameStart = (item: FileType) => {
    setRenamingItem(item);
    setRenameValue(item.file_name);
  };

  const handleRenameSubmit = async () => {
    if (!renamingItem || !renameValue.trim() || renameValue === renamingItem.file_name) {
      setRenamingItem(null);
      return;
    }
    const newName = renameValue.trim();
    if (!isWeb) await renameFile(renamingItem, newName);

    // Compute the renamed item's new absolute path (parent stays; basename swaps).
    const oldPath = renamingItem.file_path;
    const sep = oldPath.includes('\\') ? '\\' : '/';
    const parent = extractParentPath(oldPath);
    const newPath = parent ? `${parent}${sep}${newName}` : newName;

    // Sync open tabs. For a file rename, renameTab is enough. For a folder
    // rename, any tab whose path lives under the old folder needs its prefix
    // swapped so the tab doesn't point at a stale path. Do this via the store
    // state directly so a single batch covers all affected tabs.
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

    const wasActive = activeTabPath === oldPath ||
      (renamingItem.is_dir && activeTabPath?.startsWith(`${oldPath}${sep}`));

    setRenamingItem(null);
    const fresh = await loadChildren(rootPath);
    setTree(fresh);

    // Reveal the renamed item (or its active descendant) at the new location.
    if (wasActive) {
      const target = useAppStore.getState().activeTabPath;
      if (target) revealPath(fresh, target);
    } else if (!renamingItem.is_dir) {
      // Even if no tab was affected, reveal the renamed file so the user sees
      // where it landed.
      revealPath(fresh, newPath);
    }
  };

  const handleDelete = async (item: FileType) => {
    if (!isWeb) {
      if (item.is_dir) await deleteDir(item.file_path);
      else {
        await invoke('delete_file', { filePath: item.file_path });
        // Keep caches consistent with parent listing + dropped file content
        // Match trailing separator across both '/' and '\' for Windows compat
        const sepIdx = Math.max(item.file_path.lastIndexOf('/'), item.file_path.lastIndexOf('\\'));
        if (sepIdx > 0) invalidateDirCache(item.file_path.slice(0, sepIdx));
        invalidateReadCache(item.file_path);
      }
    }
    // Remove deleted item from favourites (if present)
    setFavourites((list) => list.filter((fav) => fav.file_path !== item.file_path));
    setDeletingItem(item);
    setConfirmDeleteId('');
    const fresh = await loadChildren(rootPath);
    setTree(fresh);
  };

  const handleMoveOpen = async (item: FileType) => {
    const root = await getPath('', true);
    setMoveRootPath(root);
    const items = selectedPaths.has(item.file_path) && selectedItems.length > 1 ? selectedItems : [item];
    setMoveItems(items);
  };

  const handleMoveConfirm = async (destPath: string) => {
    if (moveItems.length === 0) return;
    if (!isWeb) await moveFiles(moveItems.map((i) => i.file_path), destPath);

    // Compute new path for each moved item (preserving the OS path separator).
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

    // Keep any open tabs pointing at the moved files — renameTab also updates
    // `activeTabPath` when the active tab is one of the moved items. Without
    // this, the sidebar reveal below has nothing to anchor on.
    for (const item of moveItems) {
      renameTab(item.file_path, newPathOf(item), item.file_name);
    }

    // Track whether one of the moved items was the active tab so we can
    // reveal its new location after the tree refreshes.
    const activeMoved = moveItems.find((i) => i.file_path === activeTabPath);
    const revealTarget = activeMoved ? newPathOf(activeMoved) : null;

    setMoveItems([]);
    setSelectedItems([]);
    const fresh = await loadChildren(rootPath);
    setTree(fresh);
    if (revealTarget) revealPath(fresh, revealTarget);
  };

  const handleDuplicate = async (item: FileType) => {
    const newPath = await duplicateItem(item);
    if (!newPath) return;

    // Refresh ONLY the duplicated item's parent dir, preserving expand/children
    // state for every other node — otherwise every previously-expanded folder
    // collapses (and its children disappear until the next full reload).
    const idx = Math.max(item.file_path.lastIndexOf('/'), item.file_path.lastIndexOf('\\'));
    const parentPath = idx >= 0 ? item.file_path.slice(0, idx) : '';
    const normalizedRoot = rootPath.replace(/\/+$/, '');
    const fresh = await loadChildren(parentPath || rootPath);

    const mergePreserve = (newKids: TreeNode[], oldKids: TreeNode[] | null): TreeNode[] => {
      if (!oldKids) return newKids;
      const oldMap = new Map(oldKids.map((n) => [n.item.file_path, n]));
      return newKids.map((n) => {
        const prev = oldMap.get(n.item.file_path);
        return prev ? { ...n, expanded: prev.expanded, children: prev.children } : n;
      });
    };

    if (!parentPath || parentPath === normalizedRoot) {
      setTree((prev) => mergePreserve(fresh, prev));
    } else {
      setTree((prev) => updateNodeSync(prev, parentPath, (node) => ({
        ...node,
        expanded: true,
        children: mergePreserve(fresh, node.children),
      })));
    }
  };

  const handleFavToggle = (item: FileType) => {
    const isFav = isFavourite(item);
    setFavourites((list) => setFavouriteItem(list, item, !isFav));
  };

  const handleNewFile = async (parentPath: string, name: string) => {
    await newFile(parentPath, normalizeFileName(name));
    const fresh = await loadChildren(rootPath);
    setTree(fresh);
    // Expand the parent folder to show the new file
    revealPath(fresh, `${parentPath}/${normalizeFileName(name)}.md`);
  };

  const handleNewFolder = async (parentPath: string, name: string) => {
    await createFolder(parentPath, normalizeFileName(name));
    const fresh = await loadChildren(rootPath);
    setTree(fresh);
  };

  // Subscribe to Rust-side progress events for the active import. One listener
  // per tree instance — unmount tears it down.
  useEffect(() => {
    if (isWeb) return;
    let unlisten: UnlistenFn | null = null;
    listen<{ current: number; total: number; currentFile: string }>(
      'import-zip:progress',
      (e) => setImportProgress(e.payload)
    ).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const handleImportZipPick = async (close: () => void) => {
    if (isWeb || importRunningRef.current) return;
    close();
    log.info('[import-zip] picker opened');
    try {
      const picked = await dialogOpen({
        multiple: false,
        filters: [{ name: 'Zip archive', extensions: ['zip'] }],
        title: t('APP_MAIN_IMPORT_ZIP_PICKER_TITLE'),
      });
      if (!picked || Array.isArray(picked)) return;
      setImportZipPath(picked);
    } catch (e) {
      log.warn(`[import-zip] picker failed: ${e}`);
    }
  };

  const handleImportZipConfirmDest = async (destPath: string) => {
    const zipPath = importZipPath;
    setImportZipPath(null);
    if (!zipPath || importRunningRef.current) return;

    // Compute the deduped target folder name from the zip's basename.
    const sep = zipPath.includes('\\') ? '\\' : '/';
    const basename = zipPath.split(/[\\/]/).pop() ?? 'import';
    const base = stripZipExtension(basename);

    // Read the chosen parent's existing children so dedupe is accurate.
    const parentListing = await readDirectoryCached(destPath);
    const siblingNames = (parentListing?.files ?? []).map((f) => f.file_name);
    const finalName = dedupeFolderName(siblingNames, base);
    const targetAbsPath = `${destPath.replace(/[\\/]+$/, '')}${sep}${finalName}`;

    log.info(`[import-zip] zip selected path=${zipPath} dest=${destPath} name=${finalName}`);
    importRunningRef.current = true;
    setImportProgress({ current: 0, total: 0, currentFile: '' });

    try {
      const res: ImportZipResult = await importZipToVault(zipPath, targetAbsPath);
      log.info(`[import-zip] refresh invalidated target=${res.targetPath}`);
      invalidateDirCache(destPath);
      invalidateDirCache(res.targetPath);
      const fresh = await loadChildren(rootPath);
      setTree(fresh);
      revealPath(fresh, res.targetPath);

      // Show the vault-relative path ("Imports/binderus-icons") so the user
      // sees where the content landed, not just the leaf folder name.
      const rel = res.targetPath.startsWith(rootPath)
        ? res.targetPath.slice(rootPath.length).replace(/^[/\\]+/, '')
        : res.targetPath;
      const doneMsg = t('APP_MAIN_IMPORT_ZIP_DONE', {
        files: res.filesImported,
        folders: res.dirsImported,
        name: rel,
      });
      const message = res.skipped.length > 0
        ? `${doneMsg}\n\n${t('APP_MAIN_IMPORT_ZIP_SKIPPED', { n: res.skipped.length })}`
        : doneMsg;
      showAlert({ title: t('APP_MAIN_IMPORT_ZIP_TITLE'), message });
    } catch (err: unknown) {
      const reason = importZipErrorReason(err);
      log.error(`[import-zip] ${reason}`);
      showAlert({
        title: t('APP_MAIN_IMPORT_ZIP_TITLE'),
        message: t('APP_MAIN_IMPORT_ZIP_FAILED', { reason }),
      });
    } finally {
      importRunningRef.current = false;
      setImportProgress(null);
    }
  };

  const handleImportZipCancel = async () => {
    if (!importRunningRef.current) return;
    const { emit } = await import('@tauri-apps/api/event');
    emit('import-zip:cancel').catch(() => { /* best-effort */ });
  };

  const handleAddConfirm = (close: () => void) => {
    if (addInFolder && addName.trim()) {
      if (addInFolder.mode === 'file') handleNewFile(addInFolder.path, addName.trim());
      else handleNewFolder(addInFolder.path, addName.trim());
    }
    setAddInFolder(null); setAddName(''); close();
  };

  const handleAddCancel = (close: () => void) => {
    setAddInFolder(null); setAddName(''); close();
  };

  // Flatten the currently-visible tree once per tree-state change. Expanding a folder
  // re-runs this (cheap O(n)), and the virtualizer re-reads count/positions accordingly.
  const flatRows = useMemo(() => flattenVisible(tree), [tree]);

  // Virtualization plumbing: scroll container owns the overflow; virtualizer
  // positions each rendered row with `transform: translateY()` inside a sized spacer.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    // Row line-height measured ~28-30px in practice (text-sm + py-0.5 + hover pad).
    // React-virtual auto-corrects per-row height via ResizeObserver on measureElement,
    // but the initial estimate is used for offset math during `scrollToIndex` for
    // rows that haven't been rendered yet — too low an estimate = under-scroll.
    estimateSize: () => 30,
    overscan: 12,
    getItemKey: (index) => flatRows[index].node.item.file_path,
  });

  // Center the active tab's row in the visible window so users notice the
  // highlight even in long lists. Runs after ancestor folders have been
  // expanded (flatRows contains the row).
  //
  // Two-pass scroll: the virtualizer's offset math for a scrollToIndex far
  // below uses `estimateSize` for all unrendered rows in between, which can
  // under-shoot by many pixels. Pass 1 brings the row into the render window;
  // pass 2 uses the actual DOM element's position (measured) to center it.
  useEffect(() => {
    if (!activeTabPath) return;
    const idx = flatRows.findIndex((r) => r.node.item.file_path === activeTabPath);
    if (idx < 0) return;
    const r1 = requestAnimationFrame(() => {
      rowVirtualizer.scrollToIndex(idx, { align: 'center' });
      const r2 = requestAnimationFrame(() => {
        const el = scrollRef.current?.querySelector(`[data-index="${idx}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: 'center', behavior: 'auto' });
      });
      return () => cancelAnimationFrame(r2);
    });
    return () => cancelAnimationFrame(r1);
  }, [activeTabPath, flatRows, rowVirtualizer]);

  return (
    <div className="py-1 flex flex-col h-full min-h-0">
      {selectedItems.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1 text-xs text-gray-400">
          <span>{selectedItems.length} selected</span>
          <button className="underline hover:text-white" onClick={() => setSelectedItems([])}>clear</button>
        </div>
      )}

      {importProgress && (
        <div className="mx-2 my-1 px-2 py-1.5 rounded bg-white/5 text-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-300">
              {t('APP_MAIN_IMPORT_ZIP_PROGRESS', { current: importProgress.current, total: importProgress.total })}
            </span>
            <button
              className="opacity-60 hover:opacity-100"
              onClick={handleImportZipCancel}
              title={t('APP_MAIN_IMPORT_ZIP_CANCEL')}
            >
              <FiX size={12} />
            </button>
          </div>
          <div className="h-1 bg-white/10 rounded overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{
                width: importProgress.total > 0
                  ? `${Math.min(100, (importProgress.current / importProgress.total) * 100)}%`
                  : '0%',
              }}
            />
          </div>
          {importProgress.currentFile && (
            <div className="text-gray-500 truncate mt-1">{importProgress.currentFile}</div>
          )}
        </div>
      )}

      {/* Virtualized scroll container. Constrain its height via flex-1 so the parent
          column controls total size. `overflow-auto` is required for the virtualizer
          to observe scroll events. */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {rowVirtualizer.getVirtualItems().map((v) => {
            const row = flatRows[v.index];
            return (
              <div
                key={row.node.item.file_path}
                data-index={v.index}
                ref={rowVirtualizer.measureElement}
                // Virtualized rows each create a stacking context via `transform`.
                // Later rows paint on top of earlier ones, so a popover opened in an
                // earlier row would be obscured by the rows below it. Lift the hovered
                // row so its three-dot menu floats above sibling rows.
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)`, zIndex: hoveringId === row.node.item.file_path ? 20 : undefined }}
              >
                <TreeNodeItem
                  node={row.node}
                  depth={row.depth}
                  activeTabPath={activeTabPath}
                  selectedPaths={selectedPaths}
                  hoveringId={hoveringId}
                  confirmDeleteId={confirmDeleteId}
                  renamingItem={renamingItem}
                  renameValue={renameValue}
                  onToggle={handleToggle}
                  onFileClick={handleFileClick}
                  onSelect={handleSelect}
                  onRenameStart={handleRenameStart}
                  onRenameChange={setRenameValue}
                  onRenameSubmit={handleRenameSubmit}
                  onRenameCancel={() => setRenamingItem(null)}
                  onDeleteConfirmSet={setConfirmDeleteId}
                  onDelete={handleDelete}
                  onMoveOpen={handleMoveOpen}
                  onDuplicate={handleDuplicate}
                  onHover={setHoveringId}
                  onFavToggle={handleFavToggle}
                  isFavourite={isFavourite}
                  onNewFile={handleNewFile}
                  onNewFolder={handleNewFolder}
                  addInFolder={addInFolder}
                  addName={addName}
                  onAddModeSet={(path, mode) => { setAddInFolder({ path, mode }); setAddName(''); }}
                  onAddNameChange={setAddName}
                  onAddConfirm={handleAddConfirm}
                  onAddCancel={handleAddCancel}
                />
              </div>
            );
          })}
        </div>
      </div>

      {(onNewFile || onNewFolder) && (
        <Popover className="relative">
          {({ open, close }) => (
            <>
              <Popover.Button as="div"
                className="flex items-center justify-center py-2 mx-2 mt-1 rounded cursor-pointer opacity-30 hover:opacity-70 hover:bg-white/5 transition-opacity"
                onClick={() => { setAddInFolder(null); setAddName(''); }}>
                <FiPlus size={16} />
              </Popover.Button>
              {open && (
                <Popover.Panel className="absolute left-2 right-2 z-10" static>
                  <div className="popover-panel py-1">
                    {!addInFolder ? (
                      <>
                        {onNewFile && <button className="menu-item" onClick={() => { setAddInFolder({ path: rootPath, mode: 'file' }); setAddName(''); }}>{t('APP_MAIN_NEW_FILE')}</button>}
                        {onNewFolder && <button className="menu-item" onClick={() => { setAddInFolder({ path: rootPath, mode: 'folder' }); setAddName(''); }}>{t('APP_MAIN_NEW_FOLDER')}</button>}
                        {!isWeb && (
                          <button
                            className="menu-item"
                            disabled={importRunningRef.current}
                            onClick={() => handleImportZipPick(close)}
                          >
                            {t('APP_MAIN_IMPORT_ZIP')}
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="px-3 py-2">
                        <input autoFocus className="input-dark w-full"
                          placeholder={addInFolder.mode === 'file' ? t('APP_MAIN_NEW_FILE_PLACEHOLDER') : t('APP_MAIN_NEW_FOLDER_PLACEHOLDER')}
                          value={addName} autoComplete="off" autoCorrect="off" autoCapitalize="off"
                          onChange={(e) => setAddName(e.target.value)}
                          onKeyUp={(e) => { if (e.key === 'Enter') handleAddConfirm(close); if (e.key === 'Escape') handleAddCancel(close); }}
                        />
                        <button className="btn btn-primary mt-2 w-full" onClick={() => handleAddConfirm(close)}>
                          {addInFolder.mode === 'file' ? t('APP_MAIN_NEW_FILE') : t('APP_MAIN_NEW_FOLDER')}
                        </button>
                      </div>
                    )}
                  </div>
                </Popover.Panel>
              )}
            </>
          )}
        </Popover>
      )}

      <FolderTreeModal
        isOpen={moveItems.length > 0}
        rootPath={moveRootPath}
        onSelect={handleMoveConfirm}
        onClose={() => setMoveItems([])}
      />

      <FolderTreeModal
        isOpen={importZipPath !== null}
        rootPath={rootPath}
        confirmLabel={t('APP_MAIN_IMPORT_ZIP')}
        onSelect={handleImportZipConfirmDest}
        onClose={() => setImportZipPath(null)}
      />
    </div>
  );
}
