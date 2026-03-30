// Description: Reusable recursive folder tree component. Lazily loads sub-folders on
//   expand by invoking read_directory. Highlights the selected folder. Can be embedded
//   in modals, sidebars, or any panel that needs folder picking or navigation.
// Requirements: Tauri invoke (read_directory) in desktop mode; falls back to mock data in web/dev mode.
// Inputs: rootPath (absolute path used as tree root), selectedPath, onSelect(path: string)
// Outputs: Renders a navigable tree; calls onSelect when user clicks a folder

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FiChevronRight, FiChevronDown, FiFolder } from 'react-icons/fi';
import { isWeb } from '../../utils/base-utils';
import { mockReadDirectory } from '../../utils/mock-data';
import { ReadDirResponse } from '../../utils/tauri-utils';
import { FileType } from '../../types';

export interface FolderTreeProps {
  rootPath: string;
  selectedPath: string;
  onSelect: (path: string) => void;
}

interface TreeNode {
  item: FileType;
  children: TreeNode[] | null; // null = not yet loaded
  expanded: boolean;
}

async function loadFolders(dirPath: string): Promise<TreeNode[]> {
  let files: FileType[] = [];
  if (isWeb) {
    const res = mockReadDirectory();
    files = (res?.files as FileType[]) ?? [];
  } else {
    const res: ReadDirResponse = await invoke('read_directory', { dir: dirPath });
    files = (res?.files as FileType[]) ?? [];
  }
  return files
    .filter((f) => f.is_dir)
    .sort((a, b) => a.file_name.localeCompare(b.file_name))
    .map((item) => ({ item, children: null, expanded: false }));
}

async function toggleNodeInTree(nodes: TreeNode[], path: string): Promise<TreeNode[]> {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.item.file_path === path) {
      if (!node.expanded && node.children === null) {
        const children = await loadFolders(path);
        result.push({ ...node, expanded: true, children });
      } else {
        result.push({ ...node, expanded: !node.expanded });
      }
    } else if (node.children) {
      result.push({ ...node, children: await toggleNodeInTree(node.children, path) });
    } else {
      result.push(node);
    }
  }
  return result;
}

function FolderTreeItem({
  node,
  selectedPath,
  onToggle,
  onSelect,
  depth
}: {
  node: TreeNode;
  selectedPath: string;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const isSelected = selectedPath === node.item.file_path;
  return (
    <div>
      <div
        className={`flex items-center cursor-pointer py-1 px-2 rounded text-sm ${
          isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(node.item.file_path)}
      >
        <button
          className="mr-1 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.item.file_path);
          }}
        >
          {node.expanded ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
        </button>
        <FiFolder size={14} className="mr-1 flex-shrink-0" />
        <span className="truncate">{node.item.file_name}</span>
      </div>
      {node.expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FolderTreeItem
              key={child.item.file_path}
              node={child}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FolderTree({ rootPath, selectedPath, onSelect }: FolderTreeProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);

  useEffect(() => {
    loadFolders(rootPath).then(setTree);
  }, [rootPath]);

  const handleToggle = async (path: string) => {
    setTree(await toggleNodeInTree(tree, path));
  };

  return (
    <div>
      {/* Root row */}
      <div
        className={`flex items-center cursor-pointer py-1 px-2 rounded text-sm ${
          selectedPath === rootPath ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'
        }`}
        onClick={() => onSelect(rootPath)}
      >
        <FiFolder size={14} className="mr-1 flex-shrink-0" />
        <span className="truncate">/</span>
      </div>
      {tree.map((node) => (
        <FolderTreeItem
          key={node.item.file_path}
          node={node}
          selectedPath={selectedPath}
          onToggle={handleToggle}
          onSelect={onSelect}
          depth={1}
        />
      ))}
    </div>
  );
}
