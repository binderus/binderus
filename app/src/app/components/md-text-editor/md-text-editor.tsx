/**
 * Description: Plain-text markdown editor for "MD Text" mode.
 *   Uses an uncontrolled textarea overlaid on a mirror div so the caret never resets.
 *   Only heading lines (# … ######) receive accent color; all other text is unstyled.
 * Inputs: content (initial value), onChange callback, file (used for keying externally)
 * Outputs: calls onChange(newText) on every keystroke (debouncing is handled by the caller)
 */

import { useRef, useEffect } from 'react';

interface Props {
  content: string;
  onChange: (value: string) => void;
}

// Shared layout constants — must match between overlay and textarea.
const SHARED: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, "Courier New", monospace',
  fontSize: '0.875rem',
  lineHeight: '1.7',
  padding: '1.25rem 2rem',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
  tabSize: 2,
  boxSizing: 'border-box',
  margin: 0,
  border: 'none',
  outline: 'none',
};

const HEADING_RE = /^(#{1,6})([ \t].*)?$/;

// After HTML-escaping: [label](url), <url>, bare https:// URLs
const LINK_RE = /(\[[^\]]*\]\([^)]*\)|&lt;https?:\/\/[^&]*&gt;|https?:\/\/\S+)/g;
// Inline code: `...` (non-greedy, no newlines)
const INLINE_CODE_RE = /(`[^`\n]+`)/g;

function applyInlineHighlights(safe: string): string {
  // Inline code first, then links — avoids double-wrapping
  return safe
    .replace(INLINE_CODE_RE, '<span class="mdte-inline-code">$1</span>')
    .replace(LINK_RE, '<span class="mdte-link">$1</span>');
}

function buildOverlayHtml(text: string): string {
  const lines = text.split('\n');
  let inFence = false;
  let fenceMarker = '';

  return lines.map((line) => {
    const safe = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Detect fence open/close (``` or ~~~, 3+ chars)
    const fenceMatch = line.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fenceMatch[1][0]; // ` or ~
        return `<span class="mdte-fence-marker">${safe}</span>`;
      } else if (line[0] === fenceMarker) {
        inFence = false;
        fenceMarker = '';
        return `<span class="mdte-fence-marker">${safe}</span>`;
      }
    }

    if (inFence) return `<span class="mdte-code-block">${safe}</span>`;
    if (HEADING_RE.test(line)) return `<span class="mdte-heading">${safe}</span>`;
    return applyInlineHighlights(safe);
  }).join('\n');
}

// Overlay rebuild cadence: the overlay is a visual-only decoration (the textarea
// owns text rendering + caret), so rebuilding `innerHTML` at keystroke rate on a
// 10K-line doc wastes tens of ms per key. 150 ms trailing-debounce lets rapid
// typing coalesce to one paint while keeping highlights in sync when the user
// pauses. Pair with an immediate flush on mount / file switch so the initial
// paint always matches content.
const OVERLAY_DEBOUNCE_MS = 150;

export default function MdTextEditor({ content, onChange }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  // Holds the pending rebuild timer handle; cleared on unmount to avoid
  // innerHTML mutations on a detached node (triggers React dev warnings).
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Most recent pending value, so the trailing callback always uses latest.
  const pendingTextRef = useRef<string>('');

  const flushOverlay = (text: string) => {
    if (overlayRef.current) {
      overlayRef.current.innerHTML = buildOverlayHtml(text) + '\n';
    }
  };

  const scheduleOverlay = (text: string) => {
    pendingTextRef.current = text;
    if (overlayTimerRef.current !== null) return; // a rebuild is already queued
    overlayTimerRef.current = setTimeout(() => {
      overlayTimerRef.current = null;
      flushOverlay(pendingTextRef.current);
    }, OVERLAY_DEBOUNCE_MS);
  };

  // Sync overlay on mount / file switch (key change triggers remount)
  useEffect(() => {
    flushOverlay(content ?? '');
    // Reset scroll
    if (textareaRef.current) textareaRef.current.scrollTop = 0;
    if (overlayRef.current) overlayRef.current.scrollTop = 0;
    return () => {
      // Drop any pending rebuild so we don't write to a detached overlay node
      if (overlayTimerRef.current !== null) {
        clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end, value } = el;
    const spaces = '    ';
    const next = value.slice(0, start) + spaces + value.slice(end);
    // Use execCommand so the browser tracks the edit for undo history
    if (!document.execCommand('insertText', false, spaces)) {
      // Fallback for environments where execCommand is unsupported
      el.value = next;
      el.selectionStart = el.selectionEnd = start + spaces.length;
      scheduleOverlay(next);
      onChange(next);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    scheduleOverlay(val);
    onChange(val);
  };

  const syncScroll = () => {
    if (overlayRef.current && textareaRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Highlight overlay — sits behind textarea, pointer events disabled */}
      <div
        ref={overlayRef}
        aria-hidden
        style={{
          ...SHARED,
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
          color: 'var(--fg-primary)',
          background: 'transparent',
          zIndex: 0,
        }}
      />
      {/* Transparent textarea — owns all input; caret uses fg color */}
      <textarea
        ref={textareaRef}
        defaultValue={content ?? ''}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        style={{
          ...SHARED,
          position: 'relative',
          flex: 1,
          resize: 'none',
          background: 'transparent',
          color: 'transparent',
          caretColor: 'var(--fg-primary)',
          zIndex: 1,
        }}
      />
    </div>
  );
}
