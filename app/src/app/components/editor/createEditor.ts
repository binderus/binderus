/* Copyright 2021, Milkdown by Mirone. */
import { defaultValueCtx, Editor, editorViewOptionsCtx, remarkStringifyOptionsCtx, rootCtx } from '@milkdown/core';
import { $shortcut } from '@milkdown/utils';
import { useAppStore } from '../../hooks/use-app-store';
import { block } from '@milkdown/plugin-block';
import { clipboard } from '@milkdown/plugin-clipboard';
import { cursor } from '@milkdown/plugin-cursor';
// import { diagram } from '@milkdown/plugin-diagram';
import { emoji } from '@milkdown/plugin-emoji';
import { history } from '@milkdown/plugin-history';
import { indent } from '@milkdown/plugin-indent';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { math } from '@milkdown/plugin-math';
import { menu } from '@milkdown/plugin-menu';
import { prism } from '@milkdown/plugin-prism';
import { slash } from '@milkdown/plugin-slash';
// import { tooltip } from '@milkdown/plugin-tooltip';
import { trailing } from '@milkdown/plugin-trailing';
// import { upload } from '@milkdown/plugin-upload';
import { gfm } from '@milkdown/preset-gfm';
import { nord } from '@milkdown/theme-nord';

export const createEditor = (
  root: HTMLElement | null,
  defaultValue: string,
  readOnly: boolean | undefined,
  onChange?: (markdown: string) => void
) => {
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, defaultValue);
      ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, editable: () => !readOnly }));
      ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
        // Strip trailing backslash hard-break markers (inserted organically by remark-stringify) before saving
        let md = markdown.replace(/\\\n/g, '\n');
        if (useAppStore.getState().enterMode === 'normal') {
          // Unescape lists: \-, \>, \*, \+ at the start of visual lines trapped inside standard paragraph blocks
          md = md.replace(/^(\s*)\\([->*+])/gm, '$1$2')
               // Unescape headings: \#
               .replace(/^(\s*)\\(#+)/gm, '$1$2')
               // Unescape numbered lists: 1\.
               .replace(/^(\s*\d+)\\\./gm, '$1.');
        }
        onChange?.(md);
      });
      // Use "-" for bullet list markers instead of "*"
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, bullet: '-' as const }));
    })
    .use(emoji)
    .use(gfm)
    .use(listener)
    .use(clipboard)
    .use(history)
    .use(cursor)
    .use(prism)
    .use(math)
    .use(indent)
    // .use(upload)
    // .use(diagram)
    // .use(tooltip)
    .use(slash)
    .use(
      // Override Enter in paragraphs to insert a hard break (single newline)
      // instead of splitting into a new paragraph. Lists keep their normal Enter behavior.
      $shortcut(() => ({
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

          // Handle code fence trigger (``` or ~~~ with optional language).
          // Input rules won't fire here because the regex requires text at the block start,
          // but in normal-Enter mode prior content lives in the same paragraph.
          const fenceMatch = currentLine.match(/^(```|~~~)([a-z]*)$/);
          if (fenceMatch && dispatch) {
            const fenceType = state.schema.nodes['fence'];
            if (!fenceType) return false;
            const lang = fenceMatch[2] || '';
            const lineDocStart = $from.start() + lineParentOffset;
            let tr = state.tr;
            if (lineParentOffset > 0) {
              // Remove the hard break immediately before the trigger + the trigger itself, then split
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
    )
    .use(nord)
    .use(trailing)
    .use(block)
    .use(menu);

  return editor;
};
