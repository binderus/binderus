// Description: Inline expandable tree-view for the sidebar. Shows both files and folders
//   starting from the data root, loading children lazily on expand. Supports hover menus
//   (rename, move, delete), Cmd/Ctrl+Click multi-select, and active-file highlighting.
// Requirements: Tauri invoke (read_directory), FolderTreeModal, react-icons
// Inputs: rootPath, onFileSelect, activeTabPath
// Outputs: Renders a navigable tree; calls onFileSelect when a file is clicked

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FiChevronRight, FiChevronDown, FiMoreVertical, FiPlus } from 'react-icons/fi';
import { AiFillStar } from 'react-icons/ai';
import { Popover } from '@headlessui/react';
import { FileType } from '../../types';
import { extractParentPath, isWeb, normalizeFileName, t } from '../../utils/base-utils';
import { mockReadDirectory } from '../../utils/mock-data';
import { ReadDirResponse, deleteDir, renameFile, moveFiles, getPath, newFile, createFolder } from '../../utils/tauri-utils';
import { useAppContext } from '../../hooks/use-app-context';
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
    const res: ReadDirResponse = await invoke('read_directory', { dir: dirPath });
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

function TreeNodeItem({
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

  const rowRef = useRef<HTMLDivElement>(null);

  // Scroll active file into view
  useEffect(() => {
    if (isActive && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isActive]);

  return (
    <div>
      <div
        ref={rowRef}
        className={`flex items-center cursor-pointer text-sm py-0.5 pr-1 rounded
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
              <AiFillStar
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
                  className="ml-1 mr-2 icon-btn flex items-center flex-shrink-0"
                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); }}
                >
                  <FiMoreVertical size={14} />
                </Popover.Button>
                {open && (
                  <Popover.Panel className="absolute right-0 z-10 mt-1 w-44" static>
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
                )}
              </>
            )}
          </Popover>
        )}
      </div>

      {/* Children */}
      {item.is_dir && node.expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.item.file_path}
              node={child}
              depth={depth + 1}
              activeTabPath={activeTabPath}
              selectedPaths={selectedPaths}
              hoveringId={hoveringId}
              confirmDeleteId={confirmDeleteId}
              renamingItem={renamingItem}
              renameValue={renameValue}
              onToggle={onToggle}
              onFileClick={onFileClick}
              onSelect={onSelect}
              onRenameStart={onRenameStart}
              onRenameChange={onRenameChange}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              onDeleteConfirmSet={onDeleteConfirmSet}
              onDelete={onDelete}
              onMoveOpen={onMoveOpen}
              onHover={onHover}
              onFavToggle={onFavToggle}
              isFavourite={isFavourite}
              onNewFile={onNewFile}
              onNewFolder={onNewFolder}
              addInFolder={addInFolder}
              addName={addName}
              onAddModeSet={onAddModeSet}
              onAddNameChange={onAddNameChange}
              onAddConfirm={onAddConfirm}
              onAddCancel={onAddCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
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

  const activeTabPath = useAppStore((s) => s.activeTabPath);
  const { isFavourite, setFavourites, setDeletingItem } = useAppContext();
  const refreshFolder = useAppStore((s) => s.refreshFolder);
  const setRefreshFolder = useAppStore((s) => s.setRefreshFolder);

  const selectedPaths = new Set(selectedItems.map((i) => i.file_path));

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
    if (!isWeb) await renameFile(renamingItem, renameValue.trim());
    setRenamingItem(null);
    const fresh = await loadChildren(rootPath);
    setTree(fresh);
  };

  const handleDelete = async (item: FileType) => {
    if (!isWeb) {
      if (item.is_dir) await deleteDir(item.file_path);
      else await invoke('delete_file', { filePath: item.file_path });
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
    // Update favourites: replace old paths with new paths for moved items
    setFavourites((list) => list.map((fav) => {
      const moved = moveItems.find((i) => i.file_path === fav.file_path);
      if (!moved) return fav;
      const sep = fav.file_path.includes('\\') ? '\\' : '/';
      const newPath = destPath + sep + fav.file_name;
      return { ...fav, file_path: newPath };
    }));
    setMoveItems([]);
    setSelectedItems([]);
    const fresh = await loadChildren(rootPath);
    setTree(fresh);
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

  return (
    <div className="py-1">
      {selectedItems.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1 text-xs text-gray-400">
          <span>{selectedItems.length} selected</span>
          <button className="underline hover:text-white" onClick={() => setSelectedItems([])}>clear</button>
        </div>
      )}

      {tree.map((node) => (
        <TreeNodeItem
          key={node.item.file_path}
          node={node}
          depth={0}
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
      ))}

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
    </div>
  );
}
