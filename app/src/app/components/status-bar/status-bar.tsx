/**
 * Description: Ultra-minimal status bar at the bottom of the editor area.
 *   Left side shows vault/app state, right side shows per-document stats.
 *   Renders items from the status bar registry (built-in + plugin items).
 *   Standalone component, not part of the editor.
 * Inputs: Reads from Zustand store and StatusBarRegistry.
 * Outputs: Rendered status bar with dot-separated items.
 */

import { useRef, useState } from 'react';
import { useAppStore } from '../../hooks/use-app-store';
import { t } from '../../utils/base-utils';
import { useStatusBarRegistry, filterStatusBarItems } from './status-bar-registry';
import { getShortcutDisplay } from '../../utils/keyboard-shortcuts';
import { useShallow } from 'zustand/react/shallow';
import { useCursorPosition } from '../editor/cursor-position-plugin';
import { useImagePreviewInfo } from '../img-preview/img-preview';
import StatusBarItem from './status-bar-item';
import type { EditorMode } from '../../types';

const MODES: { value: EditorMode; label: string }[] = [
  { value: 'md', label: 'MD' },
  { value: 'md-text', label: 'MD Text' },
];

function EditorModeSelector() {
  // O(1) lookup via derived tabsById — stable reference across unrelated tab mutations
  const activeTab = useAppStore((s) => (s.activeTabPath ? s.tabsById[s.activeTabPath] : undefined));
  const setTabEditorMode = useAppStore((s) => s.setTabEditorMode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  const lcName = (activeTab?.file_name ?? '').toLowerCase();
  const isTextFile = lcName.endsWith('.md') || lcName.endsWith('.txt');
  if (!activeTab || !isTextFile) return null;

  const mode = activeTab.editorMode ?? 'md';
  const label = MODES.find((m) => m.value === mode)?.label ?? 'MD';

  const select = (value: EditorMode) => {
    setTabEditorMode(activeTab.file_path, value);
    setOpen(false);
  };

  return (
    <span ref={ref} className="status-bar-item status-bar-item-has-actions relative" style={{ position: 'relative' }}>
      <span className="status-bar-item status-bar-item-clickable" onClick={() => setOpen((v) => !v)}>
        {label}
      </span>
      {open && (
        <>
          {/* backdrop to close on outside click */}
          <span
            style={{ position: 'fixed', inset: 0, zIndex: 199 }}
            onClick={() => setOpen(false)}
          />
          <span className="status-bar-item-actions" style={{ flexDirection: 'column', left: '50%', transform: 'translateX(-50%)' }}>
            {MODES.map((m) => (
              <button
                key={m.value}
                className={`status-bar-action-btn${mode === m.value ? ' font-semibold' : ''}`}
                style={mode === m.value ? { opacity: 1, fontWeight: 600 } : {}}
                onClick={() => select(m.value)}
              >
                {m.label}
              </button>
            ))}
            <span style={{ borderTop: '1px solid var(--border-primary)', margin: '2px 4px', display: 'block', opacity: 0.4 }} />
            <span style={{ fontSize: '0.6rem', opacity: 0.45, padding: '2px 8px', whiteSpace: 'nowrap' }}>
              {getShortcutDisplay('toggle-editor-mode')}
            </span>
          </span>
        </>
      )}
    </span>
  );
}

function Sep() {
  return <span className="status-bar-sep" aria-hidden="true" />;
}

interface StatusBarProps {
  className?: string;
}

export default function StatusBar({ className }: StatusBarProps) {
  const settingJson = useAppStore((s) => s.settingJson);
  const showStatusBar = settingJson?.showStatusBar !== false;

  const vaultPath = useAppStore((s) => s.vaultPath);
  const storageBackend = useAppStore((s) => s.storageBackend);
  const isLocked = useAppStore((s) => s.isLocked);
  const encryptionEnabled = useAppStore((s) => s.encryptionEnabled);
  const activeTabPath = useAppStore((s) => s.activeTabPath);

  const cursorLine = useCursorPosition((s) => s.line);
  const cursorCol = useCursorPosition((s) => s.col);

  // Image tab: show natural dimensions. Only render when the preview store's
  // filePath matches the active tab, so tabs without an image don't get a
  // stale 0×0 or a leftover value from a previously-viewed image.
  const imgFilePath = useImagePreviewInfo((s) => s.filePath);
  const imgW = useImagePreviewInfo((s) => s.width);
  const imgH = useImagePreviewInfo((s) => s.height);
  const showImgDims = activeTabPath !== null && activeTabPath === imgFilePath && imgW > 0 && imgH > 0;

  // useShallow prevents infinite loops: filterStatusBarItems returns a new array each call,
  // so shallow equality stops useSyncExternalStore from triggering endless re-renders.
  // Reading s.items in the selector lets the React Compiler track it as a real dependency.
  const leftItems = useStatusBarRegistry(useShallow((s) => filterStatusBarItems(s.items, 'left')));
  const rightItems = useStatusBarRegistry(useShallow((s) => filterStatusBarItems(s.items, 'right')));

  if (!showStatusBar) return null;

  const vaultName = vaultPath ? vaultPath.split(/[/\\]/).filter(Boolean).pop() : '';
  const storageLabel = storageBackend === 'libsql' ? 'DB' : 'FS';
  const backendDesc = storageBackend === 'libsql'
    ? t('STATUS_DATABASE') || 'Encrypted database storage'
    : t('STATUS_FILESYSTEM') || 'Filesystem';
  const vaultText = vaultName ? `${vaultName} (${storageLabel})` : '';
  const vaultTooltip = vaultPath ? `${vaultPath} — ${backendDesc}` : backendDesc;

  return (
    <div className={`status-bar ${className ?? ''}`}>
      {/* LEFT: vault/app state */}
      <div className="status-bar-section">
        <StatusBarItem text={vaultText} tooltip={vaultTooltip} />
        {encryptionEnabled && isLocked && (
          <>
            <Sep />
            <StatusBarItem text={t('STATUS_LOCKED') || 'Locked'} />
          </>
        )}

        {/* Plugin items (left-aligned) */}
        {leftItems.map((item) => (
          <span key={item.id}>
            <Sep />
            <StatusBarItem text={item.text} tooltip={item.tooltip} onClick={item.onClick} hoverActions={item.hoverActions} />
          </span>
        ))}
      </div>

      {/* RIGHT: per-document stats */}
      <div className="status-bar-section">
        {/* Plugin items (right-aligned) */}
        {rightItems.map((item) => (
          <span key={item.id}>
            <StatusBarItem text={item.text} tooltip={item.tooltip} onClick={item.onClick} hoverActions={item.hoverActions} />
            <Sep />
          </span>
        ))}

        {showImgDims && (
          <>
            <StatusBarItem
              text={`${imgW} × ${imgH}`}
              tooltip={t('STATUS_IMAGE_DIMENSIONS') || 'Image dimensions (pixels)'}
            />
            <Sep />
          </>
        )}
        {activeTabPath && cursorLine > 0 && (
          <>
            <StatusBarItem text={`Ln ${cursorLine}, Col ${cursorCol}`} />
            <Sep />
          </>
        )}
        <EditorModeSelector />
      </div>
    </div>
  );
}
