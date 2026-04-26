/**
 * Description: Milkdown plugin that shows an emoji autocomplete dropdown when the user
 *   types `:query` (colon followed by 1+ chars). Searches node-emoji, supports arrow-key
 *   navigation, and inserts the emoji character on Enter or click.
 * Requirements: node-emoji@2, @milkdown/utils ($prose)
 * Inputs: none (responds to editor text changes)
 * Outputs: MilkdownPlugin — floating DOM dropdown shown/hidden based on `:query` pattern
 */
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { search as emojiSearch } from 'node-emoji';

const MAX_RESULTS = 8;
const TRIGGER_RE = /:([a-z0-9_+\-]{1,32})$/i;

const dropdownStyles: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  zIndex: '9999',
  width: '260px',
  maxHeight: '280px',
  overflowY: 'auto',
  background: 'var(--color-bg-secondary, #1f2937)',
  color: 'var(--color-text, #e5e7eb)',
  border: '1px solid var(--color-border, #374151)',
  borderRadius: '10px',
  boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
  padding: '6px',
  display: 'none',
};

export const emojiPickerPlugin = $prose(() => new Plugin({
  key: new PluginKey('emoji-picker'),
  view(editorView) {
    const dropdown = document.createElement('div');
    dropdown.setAttribute('role', 'listbox');
    Object.assign(dropdown.style, dropdownStyles);
    document.body.appendChild(dropdown);

    let activeIndex = 0;
    let results: { emoji: string; name: string }[] = [];
    let query = '';

    const hide = () => {
      dropdown.style.display = 'none';
      results = [];
      query = '';
    };

    const getQuery = (view: typeof editorView) => {
      const { state } = view;
      const { $from } = state.selection;
      // Only trigger inside text-containing block nodes (paragraph, heading, etc.)
      if (!$from.parent.isTextblock) return null;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, null, '\0');
      const m = TRIGGER_RE.exec(textBefore);
      return m ? m[1].toLowerCase() : null;
    };

    const insertEmoji = (view: typeof editorView, emojiChar: string, q: string) => {
      const { state } = view;
      const { $from } = state.selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, null, '\0');
      const m = TRIGGER_RE.exec(textBefore);
      if (!m) return;

      const colonStart = $from.start() + $from.parentOffset - (q.length + 1); // include ':'
      const cursorPos = $from.pos;
      const tr = state.tr.insertText(emojiChar, colonStart, cursorPos);
      view.dispatch(tr);
      view.focus();
      hide();
    };

    const render = (view: typeof editorView, q: string, res: { emoji: string; name: string }[]) => {
      activeIndex = Math.max(0, Math.min(activeIndex, res.length - 1));
      dropdown.replaceChildren();

      res.forEach((item, i) => {
        const opt = document.createElement('div');
        opt.setAttribute('role', 'option');
        opt.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
        Object.assign(opt.style, {
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '7px 10px',
          borderRadius: '7px',
          cursor: 'pointer',
          fontSize: '13px',
          background: i === activeIndex ? 'rgba(59,130,246,0.18)' : 'transparent',
        });

        const icon = document.createElement('span');
        icon.textContent = item.emoji;
        icon.style.fontSize = '18px';
        icon.style.lineHeight = '1';

        const name = document.createElement('span');
        name.textContent = `:${item.name}:`;
        name.style.opacity = '0.85';

        opt.append(icon, name);
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          insertEmoji(view, item.emoji, q);
        });
        opt.addEventListener('mouseenter', () => {
          activeIndex = i;
          render(view, q, res);
        });
        dropdown.appendChild(opt);
      });

      const active = dropdown.querySelector('[aria-selected="true"]') as HTMLElement | null;
      active?.scrollIntoView({ block: 'nearest' });
    };

    const positionDropdown = (view: typeof editorView, q: string) => {
      const { state } = view;
      const { from } = state.selection;
      const colonPos = from - q.length - 1;
      const coords = view.coordsAtPos(colonPos);
      const spaceBelow = window.innerHeight - coords.bottom;
      const dropH = Math.min(280, results.length * 38 + 12);

      if (spaceBelow >= dropH) {
        dropdown.style.top = `${coords.bottom + 4}px`;
      } else {
        dropdown.style.top = `${coords.top - dropH - 4}px`;
      }
      dropdown.style.left = `${Math.min(coords.left, window.innerWidth - 270)}px`;
    };

    // Key handler must live on the plugin view so it can intercept before ProseMirror
    const onKeyDown = (e: KeyboardEvent) => {
      if (dropdown.style.display === 'none') return;
      if (results.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopImmediatePropagation();
        activeIndex = (activeIndex + 1) % results.length;
        render(editorView, query, results);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        activeIndex = (activeIndex - 1 + results.length) % results.length;
        render(editorView, query, results);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        const chosen = results[activeIndex];
        if (chosen) insertEmoji(editorView, chosen.emoji, query);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        hide();
      }
    };

    editorView.dom.addEventListener('keydown', onKeyDown, true);

    return {
      update(view) {
        const q = getQuery(view);
        if (q === null || q.length === 0) {
          hide();
          return;
        }

        const res = emojiSearch(q).slice(0, MAX_RESULTS);
        if (res.length === 0) {
          hide();
          return;
        }

        // Reset activeIndex when query changes
        if (q !== query) {
          activeIndex = 0;
          query = q;
        }
        results = res;

        dropdown.style.display = 'block';
        positionDropdown(view, q);
        render(view, q, res);
      },
      destroy() {
        editorView.dom.removeEventListener('keydown', onKeyDown, true);
        dropdown.remove();
      },
    };
  },
}));
