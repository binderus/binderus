/**
 * Description: Hook that finds backlinks (files that reference the current note) by searching
 *   all vault files for the current file's name. Uses Tauri's find_files command.
 * Requirements: Tauri backend running (or web mock mode)
 * Inputs: filePath - the current note's file path
 * Outputs: { backlinks: FileType[], isLoading: boolean }
 * Test file location: e2e/interactive.spec.ts - run with: pnpm exec playwright test
 */
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileType } from '../types';
import { isWeb } from '../utils/base-utils';
import { getPath } from '../utils/tauri-utils';

interface BacklinksResult {
  backlinks: FileType[];
  isLoading: boolean;
}

/** Extract the note name from a file path (without extension). */
const getNoteNameFromPath = (filePath: string): string => {
  const fileName = filePath.split('/').pop() ?? '';
  return fileName.replace(/\.(md|txt)$/i, '');
};

export const useBacklinks = (filePath: string | null): BacklinksResult => {
  const [backlinks, setBacklinks] = useState<FileType[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!filePath) {
      setBacklinks([]);
      return;
    }

    let cancelled = false;
    const noteName = getNoteNameFromPath(filePath);
    if (!noteName) return;

    const search = async () => {
      setIsLoading(true);
      try {
        if (isWeb) {
          setBacklinks([]);
          return;
        }
        const basePath = await getPath('', true);
        const result: { files?: FileType[] } = await invoke('find_files', { path: basePath, name: noteName.toLowerCase() });
        if (cancelled) return;

        const linked = (result?.files ?? []).filter((f) => {
          if (f.file_path === filePath) return false;
          if (!f.file_text) return false;
          // Check for [[wikilink]] or markdown link references to this note
          const content = f.file_text;
          return content.includes(`[[${noteName}]]`) || content.includes(`[[${noteName}|`) || content.includes(`(${noteName}.md)`);
        });
        setBacklinks(linked);
      } catch {
        if (!cancelled) setBacklinks([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    search();
    return () => { cancelled = true; };
  }, [filePath]);

  return { backlinks, isLoading };
};
