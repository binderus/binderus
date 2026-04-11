/**
 * Description: Milkdown plugin that renders interactive checkboxes for GFM task list items.
 *   In Milkdown v7, extendListItemSchemaForTask only adds data-checked attributes; the actual
 *   checkbox input is no longer rendered by default. This plugin restores that behavior via a
 *   ProseMirror NodeView registered for all list_item nodes.
 * Requirements: @milkdown/utils ($prose), @milkdown/prose/state, @milkdown/prose/view
 * Inputs: none (reads list_item node attrs from ProseMirror schema)
 * Outputs: MilkdownPlugin — task list items rendered with a clickable <input type="checkbox">
 */
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { Node } from '@milkdown/prose/model';
import type { NodeViewConstructor } from '@milkdown/prose/view';

function createListItemNodeView(): NodeViewConstructor {
  return (node: Node, view, getPos) => {
    const isTask = node.attrs.checked != null;

    const li = document.createElement('li');
    // Replicate standard listItemSchema toDOM attributes
    if (node.attrs.label)    li.dataset.label    = node.attrs.label;
    if (node.attrs.listType) li.dataset.listType = node.attrs.listType;
    if (node.attrs.spread)   li.dataset.spread   = String(node.attrs.spread);

    if (!isTask) {
      // Regular list item: plain <li> with itself as contentDOM
      return {
        dom: li,
        contentDOM: li,
        update(newNode: Node) {
          if (newNode.type.name !== 'list_item' || newNode.attrs.checked != null) return false;
          return true;
        },
      };
    }

    // Task list item
    li.dataset.itemType = 'task';
    li.dataset.checked  = String(node.attrs.checked);
    li.className = 'task-list-item';

    const checkbox = document.createElement('input');
    checkbox.type    = 'checkbox';
    checkbox.checked = Boolean(node.attrs.checked);
    checkbox.className = 'task-checkbox';
    // Keep checkbox outside ProseMirror's editable area
    checkbox.setAttribute('contenteditable', 'false');

    // mousedown: prevent focus steal; change: dispatch attribute update
    checkbox.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    checkbox.addEventListener('change', () => {
      if (typeof getPos !== 'function') return;
      const pos = getPos();
      if (typeof pos !== 'number') return;
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: checkbox.checked })
      );
    });

    const contentEl = document.createElement('span');
    contentEl.className = 'task-content';

    li.appendChild(checkbox);
    li.appendChild(contentEl);

    return {
      dom: li,
      contentDOM: contentEl,
      update(newNode: Node) {
        if (newNode.type.name !== 'list_item' || newNode.attrs.checked == null) return false;
        li.dataset.checked = String(newNode.attrs.checked);
        checkbox.checked   = Boolean(newNode.attrs.checked);
        // Keep node ref current for the change handler
        node = newNode;
        return true;
      },
      stopEvent(event) {
        return event.target === checkbox;
      },
      ignoreMutation(mutation) {
        // Ignore attribute mutations on the checkbox and li itself (data-checked updates)
        return mutation.target === checkbox
          || (mutation.target === li && mutation.type === 'attributes');
      },
    };
  };
}

/** Milkdown plugin that provides an interactive checkbox NodeView for list_item nodes. */
export const taskListPlugin = $prose(() =>
  new Plugin({
    key: new PluginKey('task-list-checkbox'),
    props: {
      nodeViews: {
        list_item: createListItemNodeView(),
      },
    },
  })
);
