/**
 * Description: Rich markdown editor component built on Milkdown v7. Heavy plugins (diagram, math,
 *   prism, emoji, slash, tooltip, upload) are lazy-loaded to reduce initial bundle size.
 * Requirements: @milkdown/core, @milkdown/react, @milkdown/ctx and related plugin packages.
 * Inputs: content (markdown string), filePath, readOnly flag, onChange callback.
 * Outputs: Rendered WYSIWYG editor with full plugin support.
 */
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { defaultValueCtx, Editor, editorViewOptionsCtx, remarkStringifyOptionsCtx, rootCtx } from '@milkdown/core';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { $remark, $shortcut, $inputRule } from '@milkdown/utils';
import { katexOptionsCtx, mathInlineSchema } from '@milkdown/plugin-math';
import { nodeRule } from '@milkdown/prose';
import { diagramNodeViewPlugin } from './diagram-nodeview';
import { mathNodeViewPlugin } from './math-nodeview';

// Custom math inline input rule: stricter regex requires non-whitespace at both ends of content,
// preventing currency patterns like "$2000 and $3000" from being treated as inline math.
const currencySafeMathInlineInputRule = $inputRule(
  (ctx) => nodeRule(/(?:\$)(\S[^$]*\S|\S)(?:\$)$/, mathInlineSchema.type(ctx), {
    beforeDispatch: ({ tr, match, start }) => {
      tr.insertText(match[1] ?? '', start + 1);
    }
  })
);
import { codeBlockNodeViewPlugin } from './code-block-nodeview';
import { linkInputRule, linkTooltipPlugin } from './link-plugin';
import { tableToolbarPlugin } from './table-toolbar-plugin';
import { taskListPlugin } from './task-list-plugin';
import { columnResizingPlugin } from '@milkdown/preset-gfm';
import { createSlashMenuSpec } from './slash-menu';
// Core plugins — small, loaded eagerly
import { clipboard } from '@milkdown/plugin-clipboard';
import { cursor } from '@milkdown/plugin-cursor';
import { history } from '@milkdown/plugin-history';
import { indent } from '@milkdown/plugin-indent';
import { trailing } from '@milkdown/plugin-trailing';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { nord } from '@milkdown/theme-nord';
import { useAppStore } from '../../hooks/use-app-store';
import { sinkListItem, liftListItem } from '@milkdown/prose/schema-list';
import { 
  wikilinkInputRule, 
  linkClickHandler, 
  preprocessWikilinks, 
  preprocessUnicode, 
  postprocessWikilinks, 
  postprocessUnicode, 
  unescapeLinkUrls 
} from './wikilink-plugin';

// Import CSS for nord theme
import '@milkdown/theme-nord/style.css';

/** Lazy-loaded heavy plugins, resolved once and cached in module scope. */
type LazyPlugins = {
  plugins: any[];
  slashPlugin: any;
};

let lazyPluginsCache: LazyPlugins | null = null;
let lazyPluginsPromise: Promise<LazyPlugins> | null = null;

function loadHeavyPlugins(): Promise<LazyPlugins> {
  if (lazyPluginsCache) return Promise.resolve(lazyPluginsCache);
  if (!lazyPluginsPromise) {
    lazyPluginsPromise = Promise.all([
      import('@milkdown/plugin-diagram'),
      import('@milkdown/plugin-math'),
      import('@milkdown/plugin-prism'),
      import('@milkdown/plugin-slash'),
      import('@milkdown/plugin-tooltip'),
      import('@milkdown/plugin-upload'),
      import('@milkdown/plugin-block'),
    ]).then(([diagram, math, prism, slash, tooltip, upload, block]) => {
      // In v7, some plugins are factories or named differently.
      // For slash and tooltip, they use factories.
      const slashPlugin = slash.slashFactory('default');
      const tooltipPlugin = tooltip.tooltipFactory('default');

      lazyPluginsCache = {
        plugins: [
          diagram.diagram,
          diagramNodeViewPlugin,
          math.remarkMathPlugin,
          math.katexOptionsCtx,
          math.mathInlineSchema,
          math.mathBlockSchema,
          math.mathBlockInputRule,
          currencySafeMathInlineInputRule,
          mathNodeViewPlugin,
          prism.prism,
          codeBlockNodeViewPlugin,
          linkInputRule,
          linkTooltipPlugin,
          taskListPlugin,
          columnResizingPlugin,
          tableToolbarPlugin,
          slashPlugin,
          tooltipPlugin,
          upload.upload,
          block.block,
        ],
        slashPlugin,
      };
      return lazyPluginsCache;
    });
  }
  return lazyPluginsPromise;
}

/** Hook that returns heavy plugins once loaded, or null while loading. */
function useLazyPlugins(): LazyPlugins | null {
  const [plugins, setPlugins] = useState<LazyPlugins | null>(lazyPluginsCache);
  useEffect(() => {
    if (lazyPluginsCache) {
      setPlugins(lazyPluginsCache);
      return;
    }
    loadHeavyPlugins().then(setPlugins);
  }, []);
  return plugins;
}

interface Props {
  content?: string;
  filePath?: string;
  readOnly?: boolean;
  onChange?: (md: string) => void;
}

/** Inner editor component — rendered only after lazy plugins are loaded. */
const MdEditorInner = ({ content, readOnly = false, onChange, heavyPlugins }: Props & { heavyPlugins: LazyPlugins }) => {
  // Use CSS variables for theme colors via index.css overrides for .milkdown

  // Stable ref so useEditor factory captures plugins without re-creating
  const pluginsRef = useRef(heavyPlugins);
  pluginsRef.current = heavyPlugins;

  const { loading, get: getEditor } = useEditor(
    (root) => {
      return Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          const text = preprocessWikilinks(preprocessUnicode(content ?? ''));
          ctx.set(defaultValueCtx, text);
        })
        .config(nord)
        .use(commonmark)
        .use(gfm)
        // Strip isInline flag so single \n renders as <br>, not a space.
        // remarkLineBreak (commonmark) runs first and marks breaks isInline:true; we override that.
        .use($remark('remarkSoftBreaks', () => () => (tree: any) => {
          const fix = (node: any) => {
            if (node.type === 'break' && node.data?.isInline) delete node.data;
            node.children?.forEach(fix);
          };
          fix(tree);
        }))
        .use(clipboard)
        .use(history)
        .use(indent)
        .use(cursor)
        .use(listener)
        .use(trailing)
        .use(wikilinkInputRule)
        .use(linkClickHandler)
        .use(pluginsRef.current.plugins)
        .config((ctx) => {
          // Final configuration block after all plugins are registered
          try {
            ctx.set(pluginsRef.current.slashPlugin.key, createSlashMenuSpec(ctx));
            ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, editable: () => !readOnly }));
            ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, bullet: '-' as const }));
            ctx.update(katexOptionsCtx.key, (prev) => ({ ...prev, throwOnError: false, strict: false }));
          } catch (e) {
            // Silently skip if contexts are still missing
          }

          ctx.get(listenerCtx).markdownUpdated((_: any, markdown: string) => {
            if (!onChange) return;
            let md = markdown.replace(/\\\n/g, '\n');
            if (useAppStore.getState().enterMode === 'normal') {
              md = md.replace(/^(\s*)\\([->*+])/gm, '$1$2')
                   .replace(/^(\s*)\\(#+)/gm, '$1$2')
                   .replace(/^(\s*\d+)\\\./gm, '$1.');
            }
            md = unescapeLinkUrls(md);
            // Remove blank lines between bullet list items (Milkdown v7 listItemSchema defaults
            // spread:true, causing remark-stringify to add \n\n between nested list levels)
            md = md.replace(/(^[ \t]*- [^\n]+)\n\n+(?=[ \t]*- )/gm, '$1\n');
            md = postprocessUnicode(postprocessWikilinks(md));
            onChange(md);
          });
        })
        .use(
          $shortcut(() => ({
            Tab: (state, dispatch) => {
              const { $from } = state.selection;
              const parentNode = $from.node(-1);
              const listItemType = state.schema.nodes['list_item'];
              const taskListItemType = state.schema.nodes['task_list_item'];
              const activeType = (listItemType && parentNode?.type === listItemType)
                ? listItemType
                : (taskListItemType && parentNode?.type === taskListItemType)
                  ? taskListItemType
                : null;
              if (!activeType) return false;
              if ($from.parentOffset === 0) {
                return sinkListItem(activeType)(state, dispatch);
              }
              dispatch?.(state.tr.insertText('\t'));
              return true;
            },
            'Shift-Tab': (state, dispatch) => {
              const { $from } = state.selection;
              const parentNode = $from.node(-1);
              const listItemType = state.schema.nodes['list_item'];
              const taskListItemType = state.schema.nodes['task_list_item'];
              const activeType = (listItemType && parentNode?.type === listItemType)
                ? listItemType
                : (taskListItemType && parentNode?.type === taskListItemType)
                  ? taskListItemType
                : null;
              if (!activeType) return false;
              return liftListItem(activeType)(state, dispatch);
            },
            Enter: (state, dispatch) => {
              if (useAppStore.getState().enterMode !== 'normal') return false;
              const { $from } = state.selection;
              const inParagraph = $from.parent.type.name === 'paragraph';
              const inListItem = $from.node(-1)?.type.name === 'list_item';
              if (!inParagraph || inListItem) return false;

              let lineParentOffset = 0;
              $from.parent.forEach((node, offset) => {
                if (offset < $from.parentOffset && node.type.name === 'hardbreak') {
                  lineParentOffset = offset + node.nodeSize;
                }
              });
              const currentLine = $from.parent.textBetween(lineParentOffset, $from.parentOffset);

              if (currentLine.trim() === '' || /^#{1,6}\s*$/.test(currentLine) || /^(>|-|\*|\d+\.)\s*$/.test(currentLine)) return false;

              const fenceMatch = currentLine.match(/^(```|~~~)([a-z]*)$/);
              if (fenceMatch && dispatch) {
                const fenceType = state.schema.nodes['fence'];
                if (!fenceType) return false;
                const lang = fenceMatch[2] || '';
                const lineDocStart = $from.start() + lineParentOffset;
                let tr = state.tr;
                if (lineParentOffset > 0) {
                  tr = tr.delete(lineDocStart - 1, $from.pos);
                  tr = tr.split(tr.mapping.map(lineDocStart - 1));
                } else {
                  tr = tr.delete(lineDocStart, $from.pos);
                }
                const $cur = tr.doc.resolve(tr.mapping.map($from.pos));
                tr = tr.setBlockType($cur.pos, $cur.pos, fenceType, lang ? { language: lang } : {});
                dispatch(tr.scrollIntoView());
                return true;
              }

              const hardBreakType = state.schema.nodes['hardbreak'];
              if (!hardBreakType) return false;
              dispatch?.(state.tr.replaceSelectionWith(hardBreakType.create()).scrollIntoView());
              return true;
            }
          }))
        );
    },
    []
  );

  useEffect(() => {
    if (loading) return;
    const editor = getEditor();
    if (!editor) return;
    editor.action((ctx) => {
      try {
        ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, editable: () => !readOnly }));
        ctx.update(katexOptionsCtx.key, (prev) => ({ ...prev, throwOnError: false, strict: false }));
      } catch {
        // The editor can briefly recreate contexts during initialization in React 19.
      }
    });
  }, [readOnly, loading]);

  /** Click on empty space below content → place caret at end of last line. */
  const handleWrapperClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.ProseMirror')) return;
    const pm = (e.currentTarget as HTMLElement).querySelector('.ProseMirror') as HTMLElement;
    if (!pm) return;
    // Place a collapsed selection at the very end of the editor content
    const sel = window.getSelection();
    if (!sel) return;
    const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    let lastText: Text | null = null;
    while (walker.nextNode()) lastText = walker.currentNode as Text;
    if (lastText) {
      sel.collapse(lastText, lastText.length);
    } else {
      sel.collapse(pm, pm.childNodes.length);
    }
    pm.focus();
  };

  return (
    <div className="milkdown-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', cursor: 'text' }} onClick={handleWrapperClick}>
      <Milkdown data-testid="milkdown-editor" />
    </div>
  );
};

/** Public MdEditor — waits for heavy plugins to lazy-load, then renders the editor. */
export const MdEditor = ({ content, filePath, readOnly = false, onChange }: Props) => {
  const heavyPlugins = useLazyPlugins();

  if (!heavyPlugins) return null;

  return (
    <MdEditorInner
      content={content}
      readOnly={readOnly}
      onChange={onChange}
      heavyPlugins={heavyPlugins}
    />
  );
};
