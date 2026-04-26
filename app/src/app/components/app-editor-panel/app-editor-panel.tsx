import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../hooks/use-app-context';
import { useAppStore } from '../../hooks/use-app-store';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { debounce, getCodeLang, isImageFile, isWeb, setFavouriteItem, t } from '../../utils/base-utils';
import { getShortcutDisplay } from '../../utils/keyboard-shortcuts';
import { registerEditorFlush, unregisterEditorFlush, writeFileCached } from '../../utils/tauri-utils';
import { BsStarFill, BsStar } from 'react-icons/bs';
import { FiMoreVertical } from 'react-icons/fi';
import { Tooltip } from '../tooltip/tooltip';
import FindBar, { clearFindHighlights } from '../find-bar/find-bar';
import { mockWriteFile } from '../../utils/mock-data';
import VideoPlayer from '../video-player/video-player';
import ImgPreview from '../img-preview/img-preview';
import AppPopover from '../app-popover/app-popover';
import { toast as reactToast } from 'react-toastify';
import AudioPlayer from '../audio-player/audio-player';
import CodeEditor from '../code-editor/code-editor';
import MdTextEditor from '../md-text-editor/md-text-editor';
import BacklinksPanel from '../backlinks-panel/backlinks-panel';
import { EditorErrorBoundary } from '../editor/editor-error-boundary';
import { FileType } from '../../types';

// Preload immediately (same timing as a static import) but don't block the render tree
const _mdEditorPromise = import('../editor/md-editor');
const MdEditor = lazy(() => _mdEditorPromise.then((m) => ({ default: m.MdEditor })));
const ExportModal = lazy(() => import('../modal/export-modal'));

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
  // O(1) active-tab read via derived tabsById map — the returned reference is
  // stable across unrelated tab mutations (keystrokes in other tabs don't
  // re-render this component).
  const activeTab = useAppStore((s) => (s.activeTabPath ? s.tabsById[s.activeTabPath] : undefined));
  const markTabDirty = useAppStore((s) => s.markTabDirty);
  const updateTabContent = useAppStore((s) => s.updateTabContent);

  const file: FileType | null = activeTab
    ? { file_path: activeTab.file_path, file_name: activeTab.file_name, file_text: '', is_file: true, is_dir: false }
    : null;

  const scrollRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);

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
    // ESC closes find bar and clears highlights from anywhere (editor, sidebar, etc.)
    if (e.key === 'Escape' && findVisible) {
      e.preventDefault();
      clearFindHighlights();
      setFindVisible(false);
    }
  }, [findVisible]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    const openExport = () => setExportModalOpen(true);
    window.addEventListener('open-export-modal', openExport);
    // Apply scroll ratio broadcast from raw panel (reset mutex sync — scroll events are async)
    const onRawScroll = (e: Event) => {
      const el = scrollRef.current;
      if (!el || syncingRef.current) return;
      syncingRef.current = true;
      const ratio = (e as CustomEvent<{ ratio: number }>).detail.ratio;
      el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
      syncingRef.current = false;
    };
    window.addEventListener('raw-panel-scroll', onRawScroll);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('open-export-modal', openExport);
      window.removeEventListener('raw-panel-scroll', onRawScroll);
    };
  }, [handleKeyDown]);

  const editorOnChange = async (md: string) => {
    const filePath = file?.file_path;
    const isCodeFile = !!getCodeLang(file?.file_name ?? '');
    if (filePath?.includes('.md') || filePath?.includes('.txt') || isCodeFile) {
      if (filePath) markTabDirty(filePath, true);
      if (isWeb) {
        mockWriteFile(filePath!, md);
      } else {
        // writeFileCached keeps the read-LRU in sync so a re-open of this tab
        // hits the cache instead of round-tripping through Rust again.
        await writeFileCached(file?.file_path ?? '', md);
      }
      if (filePath) {
        markTabDirty(filePath, false);
        updateTabContent(filePath, md);
      }
    }
  };

  const debouncedEditorOnChange = useMemo(() => debounce(editorOnChange, 200), [file?.file_path]);

  // Register editor flush so graceful shutdown can fire pending debounced writes
  useEffect(() => {
    registerEditorFlush(() => debouncedEditorOnChange.flush());
    return () => unregisterEditorFlush();
  }, [debouncedEditorOnChange]);

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

  const editorMode = activeTab?.editorMode ?? 'md';
  const lcFileName = (file?.file_name ?? '').toLowerCase();
  const isTextFile = lcFileName.indexOf('.md') > 0 || lcFileName.indexOf('.txt') > 0;
  const isVideo = lcFileName.indexOf('.mp4') > 0 || lcFileName.indexOf('.webm') > 0;
  const isAudio = lcFileName.indexOf('.mp3') > 0 || lcFileName.indexOf('.ogg') > 0 || lcFileName.indexOf('.wav') > 0;
  const isImage = isImageFile(file?.file_name ?? '');
  const isCode = !!getCodeLang(file?.file_name ?? '');

  const handleEditorScroll = () => {
    if (syncingRef.current) return;
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      window.dispatchEvent(new CustomEvent('editor-panel-scroll', { detail: { ratio: el.scrollTop / max } }));
    });
  };

  return file ? (
    <div ref={scrollRef} onScroll={handleEditorScroll} className={`w-full relative flex flex-col ${className ?? ''}`}>
      {title ? (
        <div className="editor-header">
          <div className="flex items-center gap-1.5">
            <Tooltip content={t('TEXT_FAVORITE')}>
              <span className="editor-header-action" onClick={favClicked}>
                {isFav ? <BsStarFill size={16} /> : <BsStar size={16} />}
              </span>
            </Tooltip>

            <AppPopover
              panelClassName="w-64"
              buttonNode={
                <span className="editor-header-action">
                  <FiMoreVertical size={16} />
                </span>
              }
              content={
                <div className="popover-panel w-full py-1 text-xs">
                  <button
                    className="menu-item"
                    onClick={async () => {
                      if (isWeb) return;
                      if (useAppStore.getState().storageBackend !== 'filesystem') { reactToast.info(t('APP_SHOW_FILE_LOCATION_DB')); return; }
                      await revealItemInDir(file.file_path);
                    }}
                  >
                    {t('TEXT_SHOW_FILE_LOCATION')}
                  </button>
                  {isTextFile && (
                    <button
                      className="menu-item flex items-center justify-between gap-4"
                      onClick={() => window.dispatchEvent(new CustomEvent('toggle-raw-panel'))}
                    >
                      <span>{t('TEXT_SHOW_RAW_MARKDOWN')}</span>
                      <span className="text-xs opacity-50 whitespace-nowrap">{getShortcutDisplay('raw-panel')}</span>
                    </button>
                  )}
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
        editorMode === 'md-text' ? (
          <MdTextEditor
            key={file.file_path}
            content={content}
            onChange={debouncedEditorOnChange}
          />
        ) : (
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
              <Suspense fallback={null}>
                <MdEditor key={`${file.file_path}-${editorKey ?? 0}`} content={content} onChange={debouncedEditorOnChange} />
              </Suspense>
            </div>
          </EditorErrorBoundary>
        )
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
