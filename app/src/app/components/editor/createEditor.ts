/* Copyright 2021, Milkdown by Mirone. */
import { defaultValueCtx, Editor, editorViewOptionsCtx, remarkStringifyOptionsCtx, rootCtx, type KeymapItem } from '@milkdown/core';
import { $remark, $shortcut, $inputRule } from '@milkdown/utils';
import { katexOptionsCtx, remarkMathPlugin, mathInlineSchema, mathBlockSchema, mathBlockInputRule } from '@milkdown/plugin-math';
import { useAppStore } from '../../hooks/use-app-store';
import { createSlashMenuSpec } from './slash-menu';
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
import {
  linkClickHandler,
  postprocessUnicode,
  postprocessWikilinks,
  preprocessUnicode,
  preprocessWikilinks,
  unescapeLinkUrls,
  wikilinkInputRule,
} from './wikilink-plugin';
import { codeBlockNodeViewPlugin } from './code-block-nodeview';
import { pasteImagePlugin } from './paste-image-plugin';
import { imageSchemaWithWidth, remarkImageWidthPlugin } from './image-schema';
import { linkInputRule, linkTooltipPlugin } from './link-plugin';
import { tableToolbarPlugin } from './table-toolbar-plugin';
import { taskListPlugin } from './task-list-plugin';
import { columnResizingPlugin } from '@milkdown/preset-gfm';
import { block } from '@milkdown/plugin-block';
import { clipboard } from '@milkdown/plugin-clipboard';
import { cursor } from '@milkdown/plugin-cursor';
import { diagram } from '@milkdown/plugin-diagram';
import { history } from '@milkdown/plugin-history';
import { indent } from '@milkdown/plugin-indent';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
// math plugin imported as individual components above (to replace the inline input rule)
import { prism } from '@milkdown/plugin-prism';
import { slashFactory } from '@milkdown/plugin-slash';
import { trailing } from '@milkdown/plugin-trailing';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { sinkListItem, liftListItem } from '@milkdown/prose/schema-list';
import { nord } from '@milkdown/theme-nord';

export const createEditor = (
  root: HTMLElement | null,
  defaultValue: string,
  readOnly: boolean | undefined,
  onChange?: (markdown: string) => void
) => {
  const slash = slashFactory('default');

  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, preprocessWikilinks(preprocessUnicode(defaultValue)));

      ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, editable: () => !readOnly }));
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, bullet: '-' as const }));
      ctx.update(katexOptionsCtx.key, (prev) => ({ ...prev, throwOnError: false, strict: false }));
      ctx.set(slash.key, createSlashMenuSpec(ctx));

      ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
        if (!onChange) return;
        let md = markdown.replace(/\\\n/g, '\n');
        if (useAppStore.getState().enterMode === 'normal') {
          // Unescape special chars that normal-enter mode escaped
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
    .use(wikilinkInputRule)
    .use(linkClickHandler)
    .use(diagram)
    .use(diagramNodeViewPlugin)
    .use(remarkMathPlugin)
    .use(katexOptionsCtx)
    .use(mathInlineSchema)
    .use(mathBlockSchema)
    .use(mathBlockInputRule)
    .use(currencySafeMathInlineInputRule)
    .use(mathNodeViewPlugin)
    .use(prism)
    .use(linkInputRule)
    .use(linkTooltipPlugin)
    .use(codeBlockNodeViewPlugin)
    .use(pasteImagePlugin)
    .use(taskListPlugin)
    .use(columnResizingPlugin)
    .use(tableToolbarPlugin)
    .use(slash)
    .use(trailing)
    .use(block)
    .use(
      // Override Enter in paragraphs to insert a hard break (single newline)
      // instead of splitting into a new paragraph. Lists keep their normal Enter behavior.
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
          // Read enterMode at call time so the setting takes effect without editor re-init
          if (useAppStore.getState().enterMode !== 'normal') return false;
          const { $from } = state.selection;
          const inParagraph = $from.parent.type.name === 'paragraph';
          const inListItem = $from.node(-1)?.type.name === 'list_item';
          if (!inParagraph || inListItem) return false;

          // Find start of current visual line (parent offset right after last hard break)
          let lineParentOffset = 0;
          $from.parent.forEach((node, offset) => {
            if (offset < $from.parentOffset && node.type.name === 'hardbreak') {
              lineParentOffset = offset + node.nodeSize;
            }
          });
          const currentLine = $from.parent.textBetween(lineParentOffset, $from.parentOffset);

          if (currentLine.trim() === '' || /^#{1,6}\s*$/.test(currentLine) || /^(>|-|\*|\d+\.)\s*$/.test(currentLine)) return false;

          // Handle code fence trigger (``` or ~~~ with optional language).
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

  return editor;
};
