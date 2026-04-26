/**
 * Description: ProseMirror plugin that tracks cursor line and column position.
 *   Writes to a lightweight Zustand store consumed by the StatusBar component.
 * Inputs: ProseMirror editor state (selection changes).
 * Outputs: { line, col } in useCursorPosition store.
 */
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { create } from 'zustand';

interface CursorPositionState {
  line: number;
  col: number;
  setPosition: (line: number, col: number) => void;
}

export const useCursorPosition = create<CursorPositionState>((set) => ({
  line: 0,
  col: 0,
  setPosition: (line, col) => set({ line, col })
}));

export const cursorPositionPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey('cursor-position'),
    view() {
      return {
        update(view) {
          const { state } = view;
          const { from } = state.selection;

          // Get all text from doc start to cursor, using '\n' as block separator.
          // textBetween(0, from, '\n') inserts '\n' between block-level nodes,
          // so nested list items, blockquotes, etc. each produce a newline.
          const textBefore = state.doc.textBetween(0, from, '\n');
          const lines = textBefore.split('\n');
          const line = lines.length;
          const col = (lines[lines.length - 1]?.length ?? 0) + 1;

          useCursorPosition.getState().setPosition(line, col);
        }
      };
    }
  });
});
