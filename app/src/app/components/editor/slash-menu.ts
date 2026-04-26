import { editorViewCtx } from '@milkdown/core';
import { SlashProvider } from '@milkdown/plugin-slash';
import { setBlockType, wrapIn } from '@milkdown/prose/commands';
import { wrapInList } from '@milkdown/prose/schema-list';
import { diagramSchema } from '@milkdown/plugin-diagram';
import { mathBlockSchema } from '@milkdown/plugin-math';
import {
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  headingSchema,
  hrSchema,
  orderedListSchema,
  paragraphSchema
} from '@milkdown/preset-commonmark';
import { createTable } from '@milkdown/preset-gfm';

type SlashItem = {
  id: string;
  label: string;
  keywords: string[];
  run: () => void;
};

const createDiagramIdentity = () => `mermaid-${Math.random().toString(36).slice(2, 10)}`;

const listboxStyles: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  zIndex: '40',
  width: '280px',
  maxHeight: '320px',
  overflowY: 'auto',
  display: 'none',
  background: 'var(--popover-bg, #1f2937)',
  color: 'var(--menu-item-fg, #e5e7eb)',
  border: '1px solid var(--popover-border, #374151)',
  borderRadius: '10px',
  boxShadow: '0 18px 40px rgba(0, 0, 0, 0.35)',
  padding: '6px'
};

const optionBaseStyles: Partial<CSSStyleDeclaration> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  padding: '9px 10px',
  borderRadius: '8px',
  cursor: 'pointer',
  userSelect: 'none'
};

const optionActiveStyles: Partial<CSSStyleDeclaration> = {
  background: 'var(--menu-item-hover-bg, rgba(59, 130, 246, 0.18))',
  color: 'var(--menu-item-hover-fg, inherit)'
};

const optionIdleStyles: Partial<CSSStyleDeclaration> = {
  background: 'transparent'
};

const parseSlashQuery = (text: string) => {
  const match = text.match(/^\/([a-z0-9 -]*)$/i);
  return match ? match[1].trim().toLowerCase() : null;
};

export const createSlashMenuSpec = (ctx: any) => {
  const listbox = document.createElement('div');
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('tabindex', '-1');
  Object.assign(listbox.style, listboxStyles);
  listbox.dataset.show = 'false';

  let provider: SlashProvider | null = null;
  let activeIndex = 0;

  const runCommand = (command: (state: any, dispatch?: any, view?: any) => boolean) => {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const { $from } = state.selection;
    const blockStart = $from.start();
    const cursorPos = $from.pos;

    if (cursorPos > blockStart) {
      view.dispatch(state.tr.deleteRange(blockStart, cursorPos));
    }

    command(view.state, view.dispatch, view);
    view.focus();
  };

  const items: SlashItem[] = [
    {
      id: 'paragraph',
      label: 'Paragraph',
      keywords: ['text', 'paragraph', 'normal'],
      run: () => runCommand(setBlockType(paragraphSchema.type(ctx)))
    },
    {
      id: 'heading-1',
      label: 'Heading 1',
      keywords: ['h1', 'title', 'heading'],
      run: () => runCommand(setBlockType(headingSchema.type(ctx), { level: 1 }))
    },
    {
      id: 'heading-2',
      label: 'Heading 2',
      keywords: ['h2', 'section', 'heading'],
      run: () => runCommand(setBlockType(headingSchema.type(ctx), { level: 2 }))
    },
    {
      id: 'heading-3',
      label: 'Heading 3',
      keywords: ['h3', 'subsection', 'heading'],
      run: () => runCommand(setBlockType(headingSchema.type(ctx), { level: 3 }))
    },
    {
      id: 'bullet-list',
      label: 'Bullet List',
      keywords: ['list', 'bullet', 'ul'],
      run: () => runCommand(wrapInList(bulletListSchema.type(ctx)))
    },
    {
      id: 'numbered-list',
      label: 'Numbered List',
      keywords: ['list', 'ordered', 'numbered', 'ol'],
      run: () => runCommand(wrapInList(orderedListSchema.type(ctx)))
    },
    {
      id: 'blockquote',
      label: 'Blockquote',
      keywords: ['quote', 'blockquote', 'callout'],
      run: () => runCommand(wrapIn(blockquoteSchema.type(ctx)))
    },
    {
      id: 'code-block',
      label: 'Code Block',
      keywords: ['code', 'fence', 'snippet'],
      run: () => runCommand(setBlockType(codeBlockSchema.type(ctx)))
    },
    {
      id: 'math-block',
      label: 'Math Block',
      keywords: ['math', 'equation', 'latex', 'formula'],
      run: () => runCommand(setBlockType(mathBlockSchema.type(ctx), { value: '' }))
    },
    {
      id: 'mermaid-diagram',
      label: 'Mermaid Diagram',
      keywords: ['diagram', 'mermaid', 'flowchart', 'graph'],
      run: () => runCommand(setBlockType(diagramSchema.type(ctx), { identity: createDiagramIdentity(), value: '' }))
    },
    {
      id: 'divide-line',
      label: 'Divide Line',
      keywords: ['divider', 'divide', 'hr', 'horizontal', 'rule', 'separator', 'line'],
      run: () => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const { $from } = state.selection;
        const blockStart = $from.start();
        const cursorPos = $from.pos;
        let tr = state.tr;
        if (cursorPos > blockStart) tr = tr.deleteRange(blockStart, cursorPos);
        const hr = hrSchema.type(ctx).create();
        tr = tr.replaceSelectionWith(hr);
        view.dispatch(tr.scrollIntoView());
        view.focus();
      }
    },
    {
      id: 'table',
      label: 'Table',
      keywords: ['table', 'grid', 'rows', 'columns', 'spreadsheet'],
      run: () => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const { $from } = state.selection;
        const blockStart = $from.start();
        const cursorPos = $from.pos;
        let tr = state.tr;
        if (cursorPos > blockStart) tr = tr.deleteRange(blockStart, cursorPos);
        const table = createTable(ctx, 3, 3);
        tr = tr.replaceSelectionWith(table);
        view.dispatch(tr.scrollIntoView());
        view.focus();
      }
    }
  ];

  const getFilteredItems = (view: any) => {
    const query = parseSlashQuery(provider?.getContent(view) ?? '');
    if (query === null) return [];
    if (query === '') return items;
    return items.filter((item) => {
      const haystack = `${item.label} ${item.keywords.join(' ')}`.toLowerCase();
      return haystack.includes(query);
    });
  };

  let lastQuery: string | null = null;

  const render = (view: any) => {
    const filtered = getFilteredItems(view);
    const currentQuery = parseSlashQuery(provider?.getContent(view) ?? '');
    // Reset to top whenever the search query changes
    if (currentQuery !== lastQuery) {
      activeIndex = 0;
      lastQuery = currentQuery;
    }
    activeIndex = Math.min(activeIndex, Math.max(filtered.length - 1, 0));
    listbox.replaceChildren();

    filtered.forEach((item, index) => {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.dataset.id = item.id;
      option.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
      Object.assign(option.style, optionBaseStyles, index === activeIndex ? optionActiveStyles : optionIdleStyles);

      const label = document.createElement('div');
      label.textContent = item.label;
      label.style.fontWeight = '600';
      label.style.fontSize = '13px';

      const meta = document.createElement('div');
      meta.textContent = item.keywords.join(' • ');
      meta.style.fontSize = '11px';
      meta.style.opacity = '0.7';

      option.append(label, meta);
      option.addEventListener('mouseenter', () => {
        activeIndex = index;
        render(view);
      });
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => {
        item.run();
        provider?.hide();
      });
      listbox.appendChild(option);
    });

    // Scroll active option into view
    const active = listbox.querySelector('[aria-selected="true"]') as HTMLElement | null;
    active?.scrollIntoView({ block: 'nearest' });
  };

  const setVisibility = (visible: boolean) => {
    listbox.dataset.show = visible ? 'true' : 'false';
    listbox.style.display = visible ? 'block' : 'none';
  };

  return {
    view: (view: any) => {
      provider = new SlashProvider({
        content: listbox,
        debounce: 0,
        shouldShow: (editorView) => getFilteredItems(editorView).length > 0
      });
      provider.onShow = () => { activeIndex = 0; setVisibility(true); };
      provider.onHide = () => setVisibility(false);

      render(view);
      provider.update(view);

      return {
        update: (nextView: any, prevState: any) => {
          render(nextView);
          provider?.update(nextView, prevState);
        },
        destroy: () => {
          provider?.destroy();
          listbox.remove();
          provider = null;
        }
      };
    },
    props: {
      handleKeyDown: (view: any, event: KeyboardEvent) => {
        if (!provider || provider.element.dataset.show !== 'true') return false;

        const filtered = getFilteredItems(view);
        if (filtered.length === 0) return false;

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          activeIndex = (activeIndex + 1) % filtered.length;
          render(view);
          return true;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
          render(view);
          return true;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          filtered[activeIndex]?.run();
          provider.hide();
          return true;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          provider.hide();
          return true;
        }

        return false;
      }
    }
  };
};
