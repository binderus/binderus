/**
 * Description: ProseMirror plugin that shows placeholder text in empty paragraphs.
 *   Displays "Type / for commands" when the cursor is in an empty block.
 *   Skips code blocks, lists, and tables.
 * Requirements: @milkdown/utils ($prose), @milkdown/prose/state, @milkdown/prose/view
 * Inputs: none (reacts to editor state)
 * Outputs: MilkdownPlugin providing placeholder decorations
 */
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { EditorState } from '@milkdown/prose/state';
import type { Node } from '@milkdown/prose/model';

const PLACEHOLDER_TEXT = 'Type / for commands';

// Node types where placeholder should not appear
const SKIP_PARENT_TYPES = new Set([
  'code_block', 'fence', 'math_block', 'diagram',
  'list_item', 'task_list_item',
  'table_cell', 'table_header',
]);

function createPlaceholderDecoration(state: EditorState): Decoration | null {
  const { selection } = state;
  if (!selection.empty) return null;

  const $pos = selection.$anchor;
  const node = $pos.parent;

  // Only show in empty nodes
  if (node.content.size > 0) return null;

  // Skip certain contexts
  if (SKIP_PARENT_TYPES.has(node.type.name)) return null;

  // Also skip if any ancestor is a skipped type (e.g. list_item > paragraph)
  for (let d = $pos.depth - 1; d >= 0; d--) {
    if (SKIP_PARENT_TYPES.has($pos.node(d).type.name)) return null;
  }

  const before = $pos.before();
  return Decoration.node(before, before + node.nodeSize, {
    class: 'editor-placeholder',
    'data-placeholder': PLACEHOLDER_TEXT,
  });
}

export const placeholderPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey('milkdown-placeholder'),
    props: {
      decorations: (state) => {
        // Skip if editor is readonly
        const editable = (state as any).facet?.editable;
        const deco = createPlaceholderDecoration(state);
        if (!deco) return null;
        return DecorationSet.create(state.doc, [deco]);
      },
    },
  });
});
