// Description: Modal dialog wrapping the reusable FolderTree component for selecting
//   a destination folder (e.g. when moving files). Includes a search box that
//   filters folders by partial name across the entire subtree (not just visible nodes).
//   Manages its own selectedPath state and exposes a confirm/cancel interface.
// Requirements: @headlessui/react Dialog, FolderTree component, readDirectoryCached
// Inputs: isOpen, rootPath, confirmLabel (button text), onSelect(destPath), onClose
// Outputs: Calls onSelect with the chosen folder path when confirmed

import { Dialog, DialogPanel, DialogTitle, Transition } from '@headlessui/react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { FiFolder, FiSearch } from 'react-icons/fi';
import FolderTree from '../folder-tree/folder-tree';
import { t, isWeb } from '../../utils/base-utils';
import { readDirectoryCached } from '../../utils/tauri-utils';
import { mockReadDirectory } from '../../utils/mock-data';
import { FileType } from '../../types';

interface Props {
  isOpen: boolean;
  rootPath: string;
  /** Label for the confirm button. Defaults to TEXT_MOVE_TO_FOLDER. */
  confirmLabel?: string;
  onSelect: (destPath: string) => void;
  onClose: () => void;
}

interface FlatFolder {
  path: string;
  name: string;
}

/**
 * Minimal fuzzy matcher — returns a score (lower = better) if every char in
 * `q` appears in `s` in order, case-insensitive. Returns null for no match.
 * Scoring rewards contiguous runs and earlier match positions so substring
 * hits ("reports" in "weekly-reports") outrank scattered hits ("rpts").
 */
function fuzzyScore(q: string, s: string): number | null {
  if (!q) return 0;
  const query = q.toLowerCase();
  const target = s.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastMatchIdx = -2; // -2 so the first match contributes no "gap" penalty
  let firstMatchIdx = -1;
  for (let si = 0; si < target.length && qi < query.length; si++) {
    if (target[si] === query[qi]) {
      if (firstMatchIdx === -1) firstMatchIdx = si;
      // Gap penalty: 0 for contiguous (si === lastMatchIdx+1), else distance.
      score += si - lastMatchIdx - 1;
      lastMatchIdx = si;
      qi++;
    }
  }
  if (qi < query.length) return null;
  // Start-position penalty: matches further from the start cost more.
  // Length penalty (small): prefer shorter names when tied.
  return score * 10 + firstMatchIdx + target.length * 0.01;
}

/** Recursively enumerate every folder under `root` (depth-first, alphabetical). */
async function enumerateAllFolders(root: string): Promise<FlatFolder[]> {
  const out: FlatFolder[] = [{ path: root, name: '/' }];
  const walk = async (path: string): Promise<void> => {
    const res = isWeb ? mockReadDirectory() : await readDirectoryCached(path);
    const dirs = ((res?.files as FileType[]) ?? [])
      .filter((f) => f.is_dir)
      .sort((a, b) => a.file_name.localeCompare(b.file_name));
    for (const d of dirs) {
      out.push({ path: d.file_path, name: d.file_name });
      await walk(d.file_path);
    }
  };
  await walk(root);
  return out;
}

export default function FolderTreeModal({ isOpen, rootPath, confirmLabel, onSelect, onClose }: Props) {
  const [selectedPath, setSelectedPath] = useState(rootPath);
  const [query, setQuery] = useState('');
  const [allFolders, setAllFolders] = useState<FlatFolder[]>([]);

  // Reset selection + search whenever the modal opens or rootPath changes.
  // Kicks off a background enumeration so results are ready when the user starts typing.
  useEffect(() => {
    if (!isOpen) return;
    setSelectedPath(rootPath);
    setQuery('');
    let cancelled = false;
    enumerateAllFolders(rootPath).then((folders) => {
      if (!cancelled) setAllFolders(folders);
    });
    return () => { cancelled = true; };
  }, [isOpen, rootPath]);

  // Fuzzy match against the folder name first (users think in names), then fall
  // back to the path so nested typing like "proj/rpt" still works. Results are
  // ranked by score (lower = better): contiguous matches near the start win.
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return [] as FlatFolder[];
    const scored: Array<{ folder: FlatFolder; score: number }> = [];
    for (const f of allFolders) {
      const nameScore = fuzzyScore(q, f.name);
      if (nameScore !== null) {
        scored.push({ folder: f, score: nameScore });
        continue;
      }
      const pathScore = fuzzyScore(q, f.path);
      // Path-only matches are ranked worse than name matches by a constant
      // offset so name hits always bubble to the top.
      if (pathScore !== null) scored.push({ folder: f, score: pathScore + 1000 });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.map((s) => s.folder);
  }, [query, allFolders]);

  const showFiltered = query.trim().length > 0;

  /** Render a single row in the filtered-flat view. */
  const renderFlatRow = (f: FlatFolder) => {
    const isSelected = selectedPath === f.path;
    // Dim the parent path so users can distinguish same-named folders in
    // different locations. Strip the vault root prefix for compactness.
    const rel = f.path === rootPath ? '/' : f.path.replace(rootPath, '').replace(/^\/+/, '');
    const lastSlash = rel.lastIndexOf('/');
    const parent = lastSlash >= 0 ? rel.slice(0, lastSlash) : '';
    return (
      <div
        key={f.path}
        className={`flex items-center gap-2 cursor-pointer py-1 px-2 rounded text-sm ${
          isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'
        }`}
        onClick={() => setSelectedPath(f.path)}
      >
        <FiFolder size={14} className="flex-shrink-0" />
        <span className="truncate">{f.name}</span>
        {parent && <span className="truncate text-xs opacity-60">{parent}</span>}
      </div>
    );
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="fixed inset-0 z-10 overflow-y-auto" onClose={onClose}>
        <div className="min-h-screen px-4 text-center">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 z-0 bg-black/30" />
          </Transition.Child>

          <span className="inline-block h-screen align-middle" aria-hidden="true">&#8203;</span>

          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <DialogPanel className="dialog-panel relative z-10 inline-block w-full max-w-sm p-4 my-8 text-left align-middle transition-all transform rounded-lg shadow-xl">
              <DialogTitle className="text-lg font-medium mb-3">
                {t('TEXT_SELECT_DESTINATION')}
              </DialogTitle>

              <div className="relative mb-2">
                <FiSearch
                  size={14}
                  className="absolute left-2 top-1/2 -translate-y-1/2 opacity-60 pointer-events-none"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('FOLDER_PICKER_SEARCH_PLACEHOLDER')}
                  className="w-full pl-7 pr-2 py-1 text-sm bg-transparent border border-gray-600 rounded outline-none focus:border-blue-500"
                  autoFocus
                />
              </div>

              <div className="border border-gray-600 rounded p-2 overflow-y-auto" style={{ maxHeight: '300px' }}>
                {showFiltered ? (
                  filtered.length > 0 ? (
                    filtered.map(renderFlatRow)
                  ) : (
                    <div className="text-sm opacity-60 py-2 px-1">
                      {t('TEXT_NO_RESULTS')}
                    </div>
                  )
                ) : (
                  <FolderTree
                    rootPath={rootPath}
                    selectedPath={selectedPath}
                    onSelect={setSelectedPath}
                  />
                )}
              </div>

              <div className="flex justify-end gap-2 mt-4">
                <button className="btn" onClick={onClose}>
                  {t('TEXT_CANCEL')}
                </button>
                <button className="btn btn-primary" onClick={() => onSelect(selectedPath)}>
                  {confirmLabel ?? t('TEXT_MOVE_TO_FOLDER')}
                </button>
              </div>
            </DialogPanel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
