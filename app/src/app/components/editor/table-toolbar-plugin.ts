/**
 * Description: Milkdown plugin that renders a floating toolbar above a GFM table
 *   when the cursor is inside it, providing buttons to add/delete rows and columns.
 *   Uses prosemirror-tables commands directly (standard ProseMirror command API).
 * Requirements: @milkdown/utils ($prose), @milkdown/prose/tables (isInTable, addRow*,
 *   addColumn*, deleteRow, deleteColumn)
 * Inputs: none (responds to ProseMirror selection state)
 * Outputs: MilkdownPlugin — floating DOM toolbar shown/hidden based on table cursor position
 */
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import {
  isInTable,
  addRowAfter,
  addRowBefore,
  addColumnAfter,
  addColumnBefore,
  deleteRow,
  deleteColumn,
} from '@milkdown/prose/tables';

type TableCmd = (state: any, dispatch?: any, view?: any) => boolean;

const TOOLBAR_ACTIONS: { label: string; cmd: TableCmd; title: string }[] = [
  { label: '+ Row ↑', title: 'Add row before', cmd: addRowBefore },
  { label: '+ Row ↓', title: 'Add row after',  cmd: addRowAfter  },
  { label: '− Row',   title: 'Delete row',      cmd: deleteRow    },
  { label: '+ Col ←', title: 'Add column before', cmd: addColumnBefore },
  { label: '+ Col →', title: 'Add column after',  cmd: addColumnAfter  },
  { label: '− Col',   title: 'Delete column',      cmd: deleteColumn   },
];

export const tableToolbarPlugin = $prose(() => new Plugin({
  key: new PluginKey('table-toolbar'),
  view(editorView) {
    const toolbar = document.createElement('div');
    toolbar.className = 'table-toolbar';

    TOOLBAR_ACTIONS.forEach(({ label, title, cmd }) => {
      const btn = document.createElement('button');
      btn.className = 'table-toolbar-btn';
      btn.textContent = label;
      btn.title = title;
      btn.type = 'button';
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep editor focus
        cmd(editorView.state, editorView.dispatch, editorView);
        editorView.focus();
      });
      toolbar.appendChild(btn);
    });

    // Append to the editor's wrapper so offset calculations are relative to it
    const container = editorView.dom.closest('.milkdown') as HTMLElement ?? document.body;
    container.style.position = 'relative';
    container.appendChild(toolbar);

    const hide = () => { toolbar.style.display = 'none'; };
    hide();

    return {
      update(view) {
        const { state } = view;
        if (!isInTable(state)) { hide(); return; }

        const { from } = state.selection;
        const domInfo = view.domAtPos(from);
        const tableEl = (domInfo.node as Element).closest?.('table');
        if (!tableEl) { hide(); return; }

        const tableRect = tableEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        toolbar.style.display = 'flex';
        // Position just above the table, aligned to its left edge
        toolbar.style.top  = `${tableRect.top  - containerRect.top  - toolbar.offsetHeight - 4}px`;
        toolbar.style.left = `${tableRect.left - containerRect.left}px`;
      },
      destroy() {
        toolbar.remove();
      },
    };
  },
}));
