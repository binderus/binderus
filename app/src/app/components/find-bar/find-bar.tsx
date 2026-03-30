import { useEffect, useRef, useState } from 'react';
import { FiX, FiChevronUp, FiChevronDown } from 'react-icons/fi';
import { t } from '../../utils/base-utils';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface MatchInfo {
  range: Range;
}

const STYLE_ID = 'find-highlight-style';

function injectHighlightStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `::highlight(find-results) { background-color: var(--find-highlight-bg); color: inherit; }
     ::highlight(find-active) { background-color: var(--find-highlight-active-bg); color: inherit; }`;
  document.head.appendChild(style);
}

function removeHighlightStyle() {
  document.getElementById(STYLE_ID)?.remove();
}

/** Call this from outside to guarantee highlights are removed */
export function clearFindHighlights() {
  removeHighlightStyle();
  try {
    if (CSS?.highlights) {
      CSS.highlights.delete('find-results');
      CSS.highlights.delete('find-active');
      CSS.highlights.clear();
    }
  } catch (_) {}
}

export default function FindBar({ visible, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<MatchInfo[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => inputRef.current?.select());
    }
    return () => clearFindHighlights();
  }, [visible]);

  useEffect(() => {
    if (!query) {
      clearFindHighlights();
      setMatches([]);
      setCurrentIndex(0);
      return;
    }
    const found = findMatches(query);
    setMatches(found);
    setCurrentIndex(found.length > 0 ? 1 : 0);
    applyHighlights(found, 0);
  }, [query]);

  const findMatches = (text: string): MatchInfo[] => {
    const editor = document.querySelector('.milkdown .editor') as HTMLElement;
    if (!editor) return [];

    const treeWalker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const results: MatchInfo[] = [];
    const lowerQuery = text.toLowerCase();

    while (treeWalker.nextNode()) {
      const node = treeWalker.currentNode as Text;
      const content = node.textContent ?? '';
      const lowerContent = content.toLowerCase();
      let idx = lowerContent.indexOf(lowerQuery);

      while (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + text.length);
        results.push({ range });
        idx = lowerContent.indexOf(lowerQuery, idx + text.length);
      }
    }

    return results;
  };

  const applyHighlights = (matchList: MatchInfo[], activeIdx: number) => {
    clearFindHighlights();

    if (!('Highlight' in window) || !CSS.highlights || matchList.length === 0) return;

    // Inject the <style> that activates ::highlight() colors
    injectHighlightStyle();

    const allRanges = matchList.map((m) => m.range);
    CSS.highlights.set('find-results', new (window as any).Highlight(...allRanges));

    if (matchList[activeIdx]) {
      CSS.highlights.set('find-active', new (window as any).Highlight(matchList[activeIdx].range));
    }

    // Scroll to active match
    if (matchList[activeIdx]) {
      const el = matchList[activeIdx].range.startContainer.parentElement;
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  };

  const handleClose = () => {
    clearFindHighlights();
    setQuery('');
    setMatches([]);
    setCurrentIndex(0);
    onClose();
  };

  const goNext = () => {
    if (matches.length === 0) return;
    const next = currentIndex >= matches.length ? 1 : currentIndex + 1;
    setCurrentIndex(next);
    applyHighlights(matches, next - 1);
  };

  const goPrev = () => {
    if (matches.length === 0) return;
    const prev = currentIndex <= 1 ? matches.length : currentIndex - 1;
    setCurrentIndex(prev);
    applyHighlights(matches, prev - 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) goPrev();
      else goNext();
    }
  };

  if (!visible) return null;

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        className="find-bar-input"
        placeholder={t('FIND_PLACEHOLDER')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="find-bar-count">
        {query ? `${currentIndex}/${matches.length}` : ''}
      </span>
      <button className="find-bar-btn" onClick={goPrev} disabled={matches.length === 0}>
        <FiChevronUp size={14} />
      </button>
      <button className="find-bar-btn" onClick={goNext} disabled={matches.length === 0}>
        <FiChevronDown size={14} />
      </button>
      <button className="find-bar-btn" onClick={handleClose}>
        <FiX size={14} />
      </button>
    </div>
  );
}
