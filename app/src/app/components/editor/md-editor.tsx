/**
 * Description: Rich markdown editor component built on Milkdown v7. Heavy plugins (diagram, math,
 *   prism, emoji, slash, tooltip) are lazy-loaded to reduce initial bundle size. Image paste is
 *   handled by paste-image-plugin (eagerly loaded) per docs/plans/2026-04-21-editor-paste-image-to-file.md.
 * Requirements: @milkdown/core, @milkdown/react, @milkdown/ctx and related plugin packages.
 * Inputs: content (markdown string), filePath, readOnly flag, onChange callback.
 * Outputs: Rendered WYSIWYG editor with full plugin support.
 */
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { defaultValueCtx, Editor, editorViewOptionsCtx, remarkStringifyOptionsCtx, rootCtx, type KeymapItem } from '@milkdown/core';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { $remark, $shortcut, $inputRule } from '@milkdown/utils';
import { katexOptionsCtx, mathInlineSchema } from '@milkdown/plugin-math';
import { nodeRule } from '@milkdown/prose';

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
import { pasteImagePlugin } from './paste-image-plugin';
import { imageSchemaWithWidth, remarkImageWidthPlugin } from './image-schema';
import { linkInputRule, linkTooltipPlugin } from './link-plugin';
import { tableToolbarPlugin } from './table-toolbar-plugin';
import { taskListPlugin } from './task-list-plugin';
import { columnResizingPlugin } from '@milkdown/preset-gfm';
import { createSlashMenuSpec } from './slash-menu';
import { createStyleToolbarSpec } from './style-toolbar';
import { placeholderPlugin } from './placeholder-plugin';
import { cursorPositionPlugin } from './cursor-position-plugin';
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
import { TextSelection } from '@milkdown/prose/state';
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

/** Lazy-loaded heavy plugins, resolved per-content-profile and cached in module scope.
 *  Content gating: scan the markdown string once, only import the plugins the doc
 *  actually needs. Slash/tooltip are always loaded (used by all docs for UX menus). */
type LazyPlugins = {
  plugins: any[];
  slashPlugin: any;
  tooltipPlugin: any;
};

type PluginNeeds = {
  math: boolean;
  mermaid: boolean;
  prism: boolean;
  emoji: boolean;
};

// Content-profile -> cached plugin bundle. Different profiles (e.g. "math+prism" vs
// "empty") get separate entries so a light doc doesn't pay for a heavy doc's imports.
const pluginCacheByKey = new Map<string, LazyPlugins>();
const pluginPromiseByKey = new Map<string, Promise<LazyPlugins>>();

// Detect required plugins via cheap regex. Intentionally over-permissive — false positives
// just load extra code (no correctness risk); false negatives render raw markdown until
// the doc is saved-and-reopened, so err toward loading.
function detectPluginNeeds(content: string): PluginNeeds {
  const md = content ?? '';
  return {
    // $...$ or $$...$$ math — require non-whitespace next to $ to skip currency
    math:    /\$\$[\s\S]+?\$\$/.test(md) || /(^|[^\\$])\$\S[^$\n]*\S\$/.test(md),
    // ```mermaid fences (also catches ```mermaid\n)
    mermaid: /```mermaid\b/.test(md),
    // Any fenced code block with a language tag triggers prism syntax highlighting
    prism:   /```[a-zA-Z0-9+\-_]+\s*\n/.test(md),
    // :emoji_name: shortcodes (skip URLs by requiring start-of-token boundary)
    emoji:   /(^|\s):[a-z0-9_+\-]+:(?=\s|$)/.test(md),
  };
}

function profileKey(needs: PluginNeeds): string {
  // Stable key so repeat loads with the same profile hit the cache.
  return `m${+needs.math}|me${+needs.mermaid}|p${+needs.prism}|em${+needs.emoji}`;
}

function loadHeavyPlugins(content: string): Promise<LazyPlugins> {
  const needs = detectPluginNeeds(content);
  const key = profileKey(needs);
  const cached = pluginCacheByKey.get(key);
  if (cached) return Promise.resolve(cached);
  const inflight = pluginPromiseByKey.get(key);
  if (inflight) return inflight;

  // Always-loaded (UX menus + base behaviours used by all docs).
  const alwaysImports: [Promise<any>, Promise<any>, Promise<any>] = [
    import('@milkdown/plugin-slash'),
    import('@milkdown/plugin-tooltip'),
    import('@milkdown/plugin-block'),
  ];
  // Gated imports — only fetched when content calls for them. Each entry preserves
  // its own shape for the assembly step below, so we keep an index of what was loaded.
  const gated: Record<string, Promise<any> | null> = {
    math:       needs.math    ? import('@milkdown/plugin-math')     : null,
    mathNV:     needs.math    ? import('./math-nodeview')           : null,
    diagram:    needs.mermaid ? import('@milkdown/plugin-diagram')  : null,
    diagramNV:  needs.mermaid ? import('./diagram-nodeview')        : null,
    prism:      needs.prism   ? import('@milkdown/plugin-prism')    : null,
    emoji:      needs.emoji   ? import('./emoji-picker-plugin')     : null,
  };

  const promise = Promise.all([
    ...alwaysImports,
    ...Object.values(gated).map((p) => p ?? Promise.resolve(null)),
  ]).then((results) => {
    const [slash, tooltip, block] = results as [any, any, any];
    const [, , , math, mathNV, diagram, diagramNV, prism, emoji] = results as any[];

    const slashPlugin = slash.slashFactory('default');
    const tooltipPlugin = tooltip.tooltipFactory('default');

    // Assemble plugin list in the same order the editor expects, skipping gated-out entries.
    const plugins: any[] = [];
    if (diagram)   plugins.push(diagram.diagram);
    if (diagramNV) plugins.push(diagramNV.diagramNodeViewPlugin);
    if (math) {
      plugins.push(math.remarkMathPlugin);
      plugins.push(math.katexOptionsCtx);
      plugins.push(math.mathInlineSchema);
      plugins.push(math.mathBlockSchema);
      plugins.push(math.mathBlockInputRule);
      plugins.push(currencySafeMathInlineInputRule);
    }
    if (mathNV) plugins.push(mathNV.mathNodeViewPlugin);
    if (prism)  plugins.push(prism.prism);
    // Always-loaded node views + toolbars (cheap, support is universal):
    plugins.push(codeBlockNodeViewPlugin, linkInputRule, linkTooltipPlugin,
                 taskListPlugin, columnResizingPlugin, tableToolbarPlugin,
                 slashPlugin, tooltipPlugin, block.block);
    if (emoji)  plugins.push(emoji.emojiPickerPlugin);

    const bundle: LazyPlugins = { plugins, slashPlugin, tooltipPlugin };
    pluginCacheByKey.set(key, bundle);
    pluginPromiseByKey.delete(key);
    return bundle;
  });

  pluginPromiseByKey.set(key, promise);
  return promise;
}

/** Hook that returns the heavy plugins for this document profile, or null while loading. */
function useLazyPlugins(content: string): LazyPlugins | null {
  // Compute profile key via the same detector as loadHeavyPlugins; cheap and synchronous.
  const key = profileKey(detectPluginNeeds(content ?? ''));
  const [plugins, setPlugins] = useState<LazyPlugins | null>(pluginCacheByKey.get(key) ?? null);
  useEffect(() => {
    const cached = pluginCacheByKey.get(key);
    if (cached) { setPlugins(cached); return; }
    let cancelled = false;
    loadHeavyPlugins(content ?? '').then((p) => { if (!cancelled) setPlugins(p); });
    return () => { cancelled = true; };
    // Reloading on profile change is intentional — a doc that adds math after open
    // will re-trigger plugin load for the new profile (superset import).
  }, [key]);
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
        .use(remarkImageWidthPlugin)
        .use(imageSchemaWithWidth)
        .use(history)
        .use(indent)
        .use(cursor)
        .use(listener)
        .use(trailing)
        .use(placeholderPlugin)
        .use(cursorPositionPlugin)
        .use(wikilinkInputRule)
        .use(linkClickHandler)
        .use(pasteImagePlugin)
        .use(pluginsRef.current.plugins)
        .config((ctx) => {
          // Final configuration block after all plugins are registered
          try {
            ctx.set(pluginsRef.current.slashPlugin.key, createSlashMenuSpec(ctx));
            ctx.set(pluginsRef.current.tooltipPlugin.key, createStyleToolbarSpec(ctx));
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
            // Priority 100 > commonmark listItemKeymap default (50) so this runs first.
            // Without higher priority, commonmark unconditionally sinks the list item on Tab
            // regardless of cursor position.
            Tab: {
              key: 'Tab',
              onRun: (_ctx: any) => (state: any, dispatch: any) => {
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
                // Only sink (indent deeper) when caret is at the very beginning of the list item text
                if ($from.parentOffset === 0) {
                  return sinkListItem(activeType)(state, dispatch);
                }
                dispatch?.(state.tr.insertText('\t'));
                return true;
              },
              priority: 100,
            } as KeymapItem,
            'Shift-Tab': {
              key: 'Shift-Tab',
              onRun: (_ctx: any) => (state: any, dispatch: any) => {
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
              priority: 100,
            } as KeymapItem,
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
            },
            // Cmd+ArrowUp: move cursor to start of document (macOS native behavior)
            'Mod-ArrowUp': (state, dispatch) => {
              const sel = TextSelection.atStart(state.doc);
              dispatch?.(state.tr.setSelection(sel).scrollIntoView());
              return true;
            },
            // Cmd+ArrowDown: move cursor to end of document (macOS native behavior)
            'Mod-ArrowDown': (state, dispatch) => {
              const sel = TextSelection.atEnd(state.doc);
              dispatch?.(state.tr.setSelection(sel).scrollIntoView());
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

/** Public MdEditor — each instance gets its own MilkdownProvider so editor lifecycle
 *  is fully isolated. Prevents "editorView not found" errors on tab switch. */
export const MdEditor = ({ content, filePath, readOnly = false, onChange }: Props) => {
  // Content-gated: scan markdown once on mount to pick the smallest plugin set
  // (math/mermaid/prism/emoji/upload) needed for this doc. Profile cache keys by
  // exact mix, so two plain-text docs share one module import.
  const heavyPlugins = useLazyPlugins(content ?? '');

  if (!heavyPlugins) return null;

  return (
    <MilkdownProvider>
      <MdEditorInner
        content={content}
        readOnly={readOnly}
        onChange={onChange}
        heavyPlugins={heavyPlugins}
      />
    </MilkdownProvider>
  );
};
