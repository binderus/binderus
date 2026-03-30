/**
 * Description: Rich markdown editor component built on Milkdown. Heavy plugins (diagram, math,
 *   prism, emoji, slash, tooltip, upload) are lazy-loaded to reduce initial bundle size.
 * Requirements: @milkdown/core, @milkdown/react, and related plugin packages.
 * Inputs: content (markdown string), filePath, readOnly flag, onChange callback.
 * Outputs: Rendered WYSIWYG editor with full plugin support.
 */
import React, { useEffect, useRef, useState } from 'react';
import { defaultValueCtx, Editor, editorViewOptionsCtx, remarkStringifyOptionsCtx, rootCtx } from '@milkdown/core';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { ReactEditor, useEditor } from '@milkdown/react';
import { $shortcut } from '@milkdown/utils';
// Core plugins — small, loaded eagerly
import { clipboard } from '@milkdown/plugin-clipboard';
import { cursor } from '@milkdown/plugin-cursor';
import { history } from '@milkdown/plugin-history';
import { indent } from '@milkdown/plugin-indent';
import { trailing } from '@milkdown/plugin-trailing';
import { gfm } from '@milkdown/preset-gfm';
import { nord } from '@milkdown/theme-nord';
import { ThemeColor } from '@milkdown/core';
import { useAppContext } from '../../hooks/use-app-context';
import { useAppStore } from '../../hooks/use-app-store';
import { sinkListItem, liftListItem } from '@milkdown/prose/schema-list';
import type { MilkdownPlugin } from '@milkdown/core';
import { wikilinkInputRule, linkClickHandler, preprocessWikilinks, preprocessUnicode, postprocessWikilinks, postprocessUnicode } from './wikilink-plugin';

/** Each entry can be a single plugin or an AtomList (MilkdownPlugin[]) */
type PluginEntry = MilkdownPlugin | MilkdownPlugin[];

/** Lazy-loaded heavy plugins, resolved once and cached in module scope. */
let lazyPluginsCache: PluginEntry[] | null = null;
let lazyPluginsPromise: Promise<PluginEntry[]> | null = null;

function loadHeavyPlugins(): Promise<PluginEntry[]> {
  if (lazyPluginsCache) return Promise.resolve(lazyPluginsCache);
  if (!lazyPluginsPromise) {
    lazyPluginsPromise = Promise.all([
      import('@milkdown/plugin-diagram'),
      import('@milkdown/plugin-math'),
      import('@milkdown/plugin-prism'),
      import('@milkdown/plugin-emoji'),
      import('@milkdown/plugin-slash'),
      import('@milkdown/plugin-tooltip'),
      import('@milkdown/plugin-upload'),
    ]).then(([diagram, math, prism, emoji, slash, tooltip, upload]) => {
      lazyPluginsCache = [
        diagram.diagram,
        math.math,
        prism.prism,
        emoji.emoji,
        slash.slash,
        tooltip.tooltip,
        upload.upload,
      ];
      return lazyPluginsCache;
    });
  }
  return lazyPluginsPromise;
}

/** Hook that returns heavy plugins once loaded, or null while loading. */
function useLazyPlugins(): PluginEntry[] | null {
  const [plugins, setPlugins] = useState<PluginEntry[] | null>(lazyPluginsCache);
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
const MdEditorInner = ({ content, readOnly = false, onChange, heavyPlugins }: Props & { heavyPlugins: PluginEntry[] }) => {
  const { theme } = useAppContext();

  // Use CSS variables for theme colors so all themes work automatically
  const extendedNord = nord.override((emotion, manager) => {
    manager.set(ThemeColor, ([key, opacity]) => {
      // Read computed CSS variable values at render time
      const style = getComputedStyle(document.documentElement);
      const editorBg = style.getPropertyValue('--editor-bg').trim() || '#2e3440';
      const editorCodeBg = style.getPropertyValue('--editor-code-bg').trim() || '#222';
      const editorFg = style.getPropertyValue('--editor-fg').trim() || '#ccc';
      const accent = style.getPropertyValue('--accent').trim() || '#88c0d0';
      const borderPrimary = style.getPropertyValue('--border-primary').trim() || '#4c566a';
      switch (key) {
        case 'background':
          return editorCodeBg; // code block BG color
        case 'surface':
          return editorCodeBg; // code block type-dropdown & toolbar BG
        case 'neutral':
          return editorFg; // code block text color
        case 'line':
        case 'shadow':
        case 'solid':
          return borderPrimary;
        case 'primary':
          return editorFg;
        case 'secondary':
          return accent; // links in editor & selected text BG color
        default:
          return editorBg;
      }
    });
  });

  // Stable ref so useEditor factory captures plugins without re-creating
  const pluginsRef = useRef(heavyPlugins);
  pluginsRef.current = heavyPlugins;

  const { editor } = useEditor(
    (root) => {
      let e = Editor.make()
        .config((ctx) => {
          const text = preprocessWikilinks(preprocessUnicode(content ?? ''));

          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, text);
          ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, editable: () => !readOnly }));

          ctx.get(listenerCtx).markdownUpdated((_: any, markdown: string) => {
            if (!onChange) return;
            let md = markdown.replace(/\\\n/g, '\n');
            if (useAppStore.getState().enterMode === 'normal') {
              md = md.replace(/^(\s*)\\([->*+])/gm, '$1$2')
                   .replace(/^(\s*)\\(#+)/gm, '$1$2')
                   .replace(/^(\s*\d+)\\\./gm, '$1.');
            }
            md = postprocessUnicode(postprocessWikilinks(md));
            onChange(md);
          });
          ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, bullet: '-' as const }));
        })
        .use(extendedNord)
        .use(nord)
        .use(gfm)
        // Core plugins (eager)
        .use(clipboard)
        .use(history)
        .use(indent)
        .use(cursor)
        .use(listener)
        .use(trailing);

      // Wikilink support ([[target]] → clickable link) + click handler for all links
      e = e.use(wikilinkInputRule).use(linkClickHandler);

      // Heavy plugins (lazy-loaded)
      for (const plugin of pluginsRef.current) {
        e = e.use(plugin);
      }

      e = e.use(
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

      return e;
    },
    []
  );

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
      <ReactEditor editor={editor} />
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
