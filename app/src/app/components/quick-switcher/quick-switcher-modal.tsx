/**
 * Description: Quick Switcher modal (Cmd+P) with fuzzy file search and app commands.
 *   Type to filter files by name, arrow keys to navigate, Enter to open/execute.
 * Requirements: @headlessui/react, @tauri-apps/api/core
 * Inputs: isOpen flag, onClose callback, onFileSelect for opening files, action callbacks
 * Outputs: Opens selected file in editor tab or executes app command
 */
import { Dialog, Transition } from '@headlessui/react';
import { invoke } from '@tauri-apps/api/core';
import { debounce } from '../../utils/base-utils';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BsStarFill, BsFileText, BsGear, BsLock, BsTerminal, BsXCircle, BsBoxArrowUpRight } from 'react-icons/bs';
import { FileType } from '../../types';
import { getRelativePath, isWeb, t } from '../../utils/base-utils';
import { getPath } from '../../utils/tauri-utils';
import { useAppStore } from '../../hooks/use-app-store';
import { useShallow } from 'zustand/react/shallow';

interface AppCommand {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  onSelect: () => void;
}

interface QuickSwitcherItem {
  type: 'file' | 'command';
  file?: FileType;
  command?: AppCommand;
  label: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onFileSelect: (file: FileType) => void;
  commands: AppCommand[];
}

export type { AppCommand };

export default function QuickSwitcherModal({ isOpen, onClose, onFileSelect, commands }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [fileMatches, setFileMatches] = useState<FileType[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [basePath, setBasePath] = useState('');
  // useShallow: favourites is an array — avoid re-render on unrelated store mutations
  const favourites = useAppStore(useShallow((s) => s.favourites));

  // Build unified results list: commands → favourite matches → other file matches.
  // Hard-capped at MAX_RESULTS so large vaults don't render 1000+ rows and stall the
  // keyboard loop (most users scan top ~20; typing to narrow is faster than scrolling).
  const MAX_RESULTS = 100;
  const results: QuickSwitcherItem[] = useMemo(() => {
    const items: QuickSwitcherItem[] = [];
    if (query.trim()) {
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      // Filter commands by query — all tokens must match (any order)
      const matchedCommands = commands.filter((c) => {
        const text = `${c.label} ${c.id}`.toLowerCase();
        return tokens.every((t) => text.includes(t));
      });
      matchedCommands.forEach((c) => items.push({ type: 'command', command: c, label: c.label }));
      // Partition file matches: favourites first, then the rest
      const favPaths = new Set(favourites.map((f) => f.file_path));
      const favFiles: FileType[] = [];
      const otherFiles: FileType[] = [];
      for (const f of fileMatches) {
        (favPaths.has(f.file_path) ? favFiles : otherFiles).push(f);
      }
      favFiles.forEach((f) => items.push({ type: 'file', file: f, label: f.file_name }));
      otherFiles.forEach((f) => items.push({ type: 'file', file: f, label: f.file_name }));
    } else {
      // No query: show all commands
      commands.forEach((c) => items.push({ type: 'command', command: c, label: c.label }));
    }
    return items.length > MAX_RESULTS ? items.slice(0, MAX_RESULTS) : items;
  }, [query, fileMatches, commands, favourites]);

  // Search files via Tauri backend
  const searchFiles = useCallback(
    debounce(async (text: string) => {
      if (!text.trim() || isWeb) {
        setFileMatches([]);
        setIsSearching(false);
        return;
      }
      try {
        const base = await getPath('', true);
        setBasePath(base);
        const foundList: { files?: FileType[] } = await invoke('find_files', {
          path: base,
          name: text
        });
        setFileMatches(foundList?.files ?? []);
      } catch {
        setFileMatches([]);
      }
      setIsSearching(false);
    }, 200),
    []
  );

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setQuery(text);
    setSelectedIndex(0);
    if (text.trim()) {
      setIsSearching(true);
      searchFiles(text);
    } else {
      setFileMatches([]);
      setIsSearching(false);
    }
  };

  const selectItem = (item: QuickSwitcherItem) => {
    onClose();
    if (item.type === 'file' && item.file) {
      onFileSelect(item.file);
    } else if (item.type === 'command' && item.command) {
      item.command.onSelect();
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((idx) => (idx < results.length - 1 ? idx + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((idx) => (idx > 0 ? idx - 1 : results.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) selectItem(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setFileMatches([]);
      setSelectedIndex(0);
      setIsSearching(false);
      // Focus input after transition
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="fixed inset-0 z-50 overflow-y-auto" onClose={onClose}>
        <div className="min-h-screen px-4 pt-[15vh]">
          {/* Backdrop */}
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-150"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 z-0 bg-black/40" />
          </Transition.Child>

          {/* Panel */}
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-150"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-100"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <div
              className="relative z-10 mx-auto w-full rounded-xl shadow-2xl overflow-hidden"
              style={{ maxWidth: 624, background: 'var(--bg-primary)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {/* Search input */}
              <div className="flex items-center px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <BsTerminal className="mr-3 opacity-40" size={16} />
                <input
                  ref={inputRef}
                  className="w-full bg-transparent text-sm outline-none placeholder-gray-500"
                  placeholder={t('QUICK_SWITCHER_PLACEHOLDER') || 'Search files or commands...'}
                  value={query}
                  onChange={handleQueryChange}
                  onKeyDown={handleKeyDown}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                {isSearching && <span className="text-xs opacity-40 ml-2">...</span>}
              </div>

              {/* Results list */}
              <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: 360 }}>
                {results.length === 0 && query.trim() && !isSearching && (
                  <div className="px-4 py-6 text-center text-sm opacity-40">{t('SEARCH_NO_RESULTS')}</div>
                )}
                {results.map((item, idx) => (
                  <div
                    key={item.type === 'file' ? item.file!.file_path : item.command!.id}
                    data-index={idx}
                    className={`flex items-center px-4 py-2 cursor-pointer text-sm ${
                      idx === selectedIndex ? 'bg-blue-600/20' : 'hover:bg-white/5'
                    }`}
                    onClick={() => selectItem(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="mr-3 opacity-50">
                      {item.type === 'file'
                        ? (favourites.some((f) => f.file_path === item.file!.file_path)
                          ? <BsStarFill size={14} className="text-yellow-400" />
                          : <BsFileText size={14} />)
                        : item.command!.icon}
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.type === 'file' && item.file && (
                      <span className="text-xs opacity-30 ml-2 truncate" style={{ maxWidth: 200 }}>
                        {getRelativePath(item.file.file_path, basePath)}
                      </span>
                    )}
                    {item.type === 'command' && item.command?.shortcut && (
                      <span className="text-xs opacity-30 ml-2">{item.command.shortcut}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Footer hint */}
              <div
                className="flex items-center justify-between px-4 py-2 text-xs opacity-30"
                style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span>
                  <kbd className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.1)' }}>
                    ↑↓
                  </kbd>{' '}
                  {t('QUICK_SWITCHER_HINT_NAVIGATE')}{' '}
                  <kbd className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.1)' }}>
                    ↵
                  </kbd>{' '}
                  {t('QUICK_SWITCHER_HINT_OPEN')}{' '}
                  <kbd className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.1)' }}>
                    esc
                  </kbd>{' '}
                  {t('QUICK_SWITCHER_HINT_CLOSE')}
                </span>
              </div>
            </div>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
