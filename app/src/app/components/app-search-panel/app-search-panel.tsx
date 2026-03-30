import { invoke } from '@tauri-apps/api/core';
import { debounce } from '../../utils/base-utils';
import { useMemo, useRef } from 'react';
import { useState } from 'react';
import { useAppContext } from '../../hooks/use-app-context';
import { useAppStore } from '../../hooks/use-app-store';
import { FileType } from '../../types';
import { addItemtoRecentList, focusEditor, getRelativePath, isGlobalShortcut, t } from '../../utils/base-utils';
import { getPath } from '../../utils/tauri-utils';
import { AiFillStar } from 'react-icons/ai';

export default () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [rawMatches, setRawMatches] = useState<FileType[]>([]);
  const { setRecentList } = useAppContext();
  const openTab = useAppStore((s) => s.openTab);
  const favourites = useAppStore((s) => s.favourites);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [basePath, setBasePath] = useState('');

  // Sort matches: favourites first, then the rest
  const matches = useMemo(() => {
    const favPaths = new Set(favourites.map((f) => f.file_path));
    const favFiles: FileType[] = [];
    const otherFiles: FileType[] = [];
    for (const f of rawMatches) {
      (favPaths.has(f.file_path) ? favFiles : otherFiles).push(f);
    }
    return [...favFiles, ...otherFiles];
  }, [rawMatches, favourites]);

  const searchChanged = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = `${e.target.value}`.toLowerCase();
    setSearch(text);
    if (text.trim()) {
      const base = await getPath('', true);
      setBasePath(base);
      const foundList: any = await invoke('find_files', { path: base, name: text });
      setRawMatches(foundList?.files ?? []);
      setSelectedIndex(0);
    } else {
      setRawMatches([]);
    }
  };
  const searchChangedDebounced = debounce(searchChanged, 250);

  const matchSelected = (item: FileType, idx: number) => {
    setSelectedIndex(idx);
    openTab(item);
    focusEditor(true);
    setRecentList((list) => addItemtoRecentList(list, item));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isGlobalShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((idx) => (idx < matches.length - 1 ? idx + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((idx) => (idx > 0 ? idx - 1 : matches.length - 1));
    } else if (e.key === 'Enter') {
      matchSelected(matches[selectedIndex], selectedIndex);
    }
  };

  return (
    <>
      <div className="text-sm text-gray-100">{t('APP_MAIN_TAB_SEARCH')}</div>
      <div>
        <input
          ref={inputRef}
          data-id="searchInput"
          className="p-1 mt-2 w-full bg-black text-white text-sm"
          placeholder=""
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          onChange={searchChangedDebounced}
          onKeyDown={onKeyDown}
        />
      </div>
      <ul className="mt-4" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
        {matches.map((item, idx) => {
          return (
            <li
              key={item.file_path}
              className={`mt-4 p-2 border border-gray-800 cursor-pointer hover:bg-gray-800 ${
                selectedIndex === idx && `bg-gray-800`
              }`}
              onClick={() => matchSelected(item, idx)}
            >
              <div className="text-sm text-gray-400 flex items-center gap-1.5">
                {favourites.some((f) => f.file_path === item.file_path) && <AiFillStar size={12} className="text-yellow-400 flex-shrink-0" />}
                {item.file_name}
              </div>
              <div className="text-xs text-gray-600 truncate">{getRelativePath(item.file_path, basePath)}</div>
            </li>
          );
        })}

        {search && matches.length === 0 && <div className="text-gray-400 text-sm">{t('SEARCH_NO_RESULTS')}</div>}
      </ul>
    </>
  );
};
