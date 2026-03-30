import { useAppContext } from '../../hooks/use-app-context';
import { useAppStore } from '../../hooks/use-app-store';
import { MdEditor } from '../editor/md-editor';
import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { debounce } from '../../utils/base-utils';
import { AiFillStar, AiOutlineStar } from 'react-icons/ai';
import { FiMoreVertical } from 'react-icons/fi';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Tooltip } from '../tooltip/tooltip';
import { getCodeLang, isImageFile, isWeb, setFavouriteItem, t } from '../../utils/base-utils';
import FindBar, { clearFindHighlights } from '../find-bar/find-bar';
import { mockWriteFile } from '../../utils/mock-data';
import VideoPlayer from '../video-player/video-player';
import ImgPreview from '../img-preview/img-preview';
import AppPopover from '../app-popover/app-popover';
import AudioPlayer from '../audio-player/audio-player';
import CodeEditor from '../code-editor/code-editor';
import BacklinksPanel from '../backlinks-panel/backlinks-panel';
import { EditorErrorBoundary } from '../editor/editor-error-boundary';
const ExportModal = lazy(() => import('../modal/export-modal'));
import { FileType } from '../../types';

interface Props {
  isLoading: boolean;
  onRenameFile: (newFileName: string) => void;
  onFileSelect?: (file: FileType) => void;
  content: string | null;
  editorKey?: number;
  className?: string;
}

export default ({ onRenameFile, onFileSelect, isLoading, content, editorKey, className }: Props) => {
  const { favourites, setFavourites, isFavourite } = useAppContext();
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.file_path === s.activeTabPath));
  const markTabDirty = useAppStore((s) => s.markTabDirty);
  const updateTabContent = useAppStore((s) => s.updateTabContent);

  const file: FileType | null = activeTab
    ? { file_path: activeTab.file_path, file_name: activeTab.file_name, file_text: '', is_file: true, is_dir: false }
    : null;

  const [isFav, setIsFav] = useState(false);
  const [findVisible, setFindVisible] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  useEffect(() => {
    setIsFav(isFavourite(file));
  }, [activeTab?.file_path]);

  useEffect(() => {
    clearFindHighlights();
    setFindVisible(false);
  }, [file?.file_path]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      setFindVisible(true);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const editorOnChange = async (md: string) => {
    const filePath = file?.file_path;
    const isCodeFile = !!getCodeLang(file?.file_name ?? '');
    if (filePath?.includes('.md') || filePath?.includes('.txt') || isCodeFile) {
      if (filePath) markTabDirty(filePath, true);
      if (isWeb) {
        mockWriteFile(filePath!, md);
      } else {
        await invoke('write_file', { filePath: file?.file_path, text: md });
      }
      if (filePath) {
        markTabDirty(filePath, false);
        updateTabContent(filePath, md);
      }
    }
  };

  const debouncedEditorOnChange = useMemo(() => debounce(editorOnChange, 200), [file?.file_path]);
  const title = file?.file_name;

  const favClicked = () => {
    if (file) {
      if (isFav === true) {
        setFavourites((list) => setFavouriteItem(list, file, false));
        setIsFav(false);
      } else {
        setFavourites((list) => setFavouriteItem(list, file, true));
        setIsFav(true);
      }
    }
  };

  const lcFileName = (file?.file_name ?? '').toLowerCase();
  const isTextFile = lcFileName.indexOf('.md') > 0 || lcFileName.indexOf('.txt') > 0;
  const isVideo = lcFileName.indexOf('.mp4') > 0 || lcFileName.indexOf('.webm') > 0;
  const isAudio = lcFileName.indexOf('.mp3') > 0 || lcFileName.indexOf('.ogg') > 0 || lcFileName.indexOf('.wav') > 0;
  const isImage = isImageFile(file?.file_name ?? '');
  const isCode = !!getCodeLang(file?.file_name ?? '');

  return file ? (
    <div className={`w-full relative flex flex-col ${className ?? ''}`}>
      {title ? (
        <div className="editor-header">
          <div className="flex items-center gap-1.5">
            <Tooltip content={t('TEXT_FAVORITE')}>
              <span className="editor-header-action" onClick={favClicked}>
                {isFav ? <AiFillStar size={16} /> : <AiOutlineStar size={16} />}
              </span>
            </Tooltip>

            <AppPopover
              buttonNode={
                <span className="editor-header-action">
                  <FiMoreVertical size={16} />
                </span>
              }
              content={
                <div className="popover-panel w-48 py-1">
                  <button
                    className="menu-item"
                    onClick={async () => {
                      if (!isWeb) await revealItemInDir(file.file_path);
                    }}
                  >
                    {t('TEXT_SHOW_FILE_LOCATION')}
                  </button>
                  {isTextFile && (
                    <button
                      className="menu-item"
                      onClick={() => setExportModalOpen(true)}
                    >
                      Export and Print…
                    </button>
                  )}
                </div>
              }
              onConfirm={() => {}}
            />
          </div>
        </div>
      ) : null}

      <FindBar visible={findVisible} onClose={() => {
        clearFindHighlights();
        setFindVisible(false);
      }} />

      {isTextFile && !isLoading && file?.file_path && content !== null && (
        <EditorErrorBoundary
          key={`${file.file_path}-${editorKey ?? 0}`}
          fallback={() => (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="px-4 py-2 text-xs text-yellow-400 bg-yellow-900/20">
                {t('EDITOR_PARSE_ERROR') || 'This note contains markdown that the rich editor cannot render. Editing in plain text mode.'}
              </div>
              <CodeEditor file={file} value={content} onChange={debouncedEditorOnChange} />
            </div>
          )}
        >
          <div className="flex-1 flex flex-col min-h-0">
            <MdEditor key={`${file.file_path}-${editorKey ?? 0}`} content={content} onChange={debouncedEditorOnChange} />
          </div>
        </EditorErrorBoundary>
      )}

      {isVideo && !isLoading && file?.file_path && <VideoPlayer url={file?.file_path} />}

      {isAudio && !isLoading && file?.file_path && <AudioPlayer url={file?.file_path} />}

      {isImage && !isLoading && file?.file_path && <ImgPreview url={file?.file_path} className="ml-8 mt-5" />}

      {isCode && !isLoading && file?.file_path && content !== null && (
        <CodeEditor
          file={file}
          value={content}
          onChange={debouncedEditorOnChange}
        />
      )}

      {isTextFile && onFileSelect && (
        <BacklinksPanel filePath={file?.file_path ?? null} onFileSelect={onFileSelect} />
      )}

      {exportModalOpen && (
        <Suspense fallback={null}>
          <ExportModal
            isOpen={true}
            onClose={() => setExportModalOpen(false)}
            markdown={activeTab?.content ?? ''}
            fileName={file.file_name}
          />
        </Suspense>
      )}
    </div>
  ) : null;
};
