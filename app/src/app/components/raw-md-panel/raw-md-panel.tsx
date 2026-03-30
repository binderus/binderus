/**
 * Description: Slide-out panel from the right showing the raw markdown text of the active file.
 *   Hidden admin feature — allows direct editing of raw .md content, saving and syncing to the main editor.
 * Requirements: Active tab must be a .md or .txt file. Tauri invoke or mock available.
 * Inputs: visible (boolean toggle), content (string | null), filePath (string | null)
 * Outputs: Edits saved to disk via write_file; tab content updated in Zustand store.
 */

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { debounce, isWeb, t } from '../../utils/base-utils';
import { mockWriteFile } from '../../utils/mock-data';
import { useAppStore } from '../../hooks/use-app-store';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  content: string | null;
  filePath: string | null;
}

export default function RawMdPanel({ visible, onClose, onSaved, content, filePath }: Props) {
  const updateTabContent = useAppStore((s) => s.updateTabContent);
  const markTabDirty = useAppStore((s) => s.markTabDirty);
  const [text, setText] = useState(content ?? '');

  // Sync textarea when file switches, panel opens, or main editor updates content
  useEffect(() => {
    setText((prev) => {
      const next = content ?? '';
      return prev === next ? prev : next;
    });
  }, [filePath, visible, content]);

  const saveToFile = useCallback(
    async (value: string) => {
      if (!filePath) return;
      markTabDirty(filePath, true);
      if (isWeb) {
        mockWriteFile(filePath, value);
      } else {
        await invoke('write_file', { filePath, text: value });
      }
      updateTabContent(filePath, value);
      markTabDirty(filePath, false);
      onSaved();
    },
    [filePath, onSaved]
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSave = useCallback(debounce(saveToFile, 300), [saveToFile]);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    debouncedSave(value);
  };

  return (
    <div
      className="fixed top-0 right-0 h-full flex flex-col border-l border-gray-600 shadow-2xl"
      style={{
        width: '40vw',
        zIndex: 9999,
        backgroundColor: 'var(--bg-primary)',
        transform: visible ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s ease',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">{t('RAW_MD_TITLE')}</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="text-gray-400 hover:text-white text-lg leading-none px-2 cursor-pointer"
          title={t('RAW_MD_CLOSE_TITLE')}
        >
          ×
        </button>
      </div>

      {/* Textarea */}
      <textarea
        className="flex-1 w-full resize-none bg-transparent text-sm font-mono p-4 outline-none text-[var(--color-text)] placeholder-gray-500"
        value={text}
        onChange={onChange}
        placeholder={t('RAW_MD_NO_CONTENT')}
        spellCheck={false}
      />
    </div>
  );
}
