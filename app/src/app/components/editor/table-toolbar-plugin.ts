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
import { t } from '../../utils/base-utils';

type TableCmd = (state: any, dispatch?: any, view?: any) => boolean;

// Action keys are resolved via t() at toolbar-build time (inside view()) so the
// current locale is picked up rather than whatever happened to be active at
// module load. i18n keys live under TABLE_TOOLBAR_* in src/locales/*.json.
const TOOLBAR_ACTIONS: { labelKey: string; titleKey: string; cmd: TableCmd }[] = [
  { labelKey: 'TABLE_TOOLBAR_ADD_ROW_BEFORE_LABEL', titleKey: 'TABLE_TOOLBAR_ADD_ROW_BEFORE_TITLE', cmd: addRowBefore   },
  { labelKey: 'TABLE_TOOLBAR_ADD_ROW_AFTER_LABEL',  titleKey: 'TABLE_TOOLBAR_ADD_ROW_AFTER_TITLE',  cmd: addRowAfter    },
  { labelKey: 'TABLE_TOOLBAR_DELETE_ROW_LABEL',     titleKey: 'TABLE_TOOLBAR_DELETE_ROW_TITLE',     cmd: deleteRow      },
  { labelKey: 'TABLE_TOOLBAR_ADD_COL_BEFORE_LABEL', titleKey: 'TABLE_TOOLBAR_ADD_COL_BEFORE_TITLE', cmd: addColumnBefore},
  { labelKey: 'TABLE_TOOLBAR_ADD_COL_AFTER_LABEL',  titleKey: 'TABLE_TOOLBAR_ADD_COL_AFTER_TITLE',  cmd: addColumnAfter },
  { labelKey: 'TABLE_TOOLBAR_DELETE_COL_LABEL',     titleKey: 'TABLE_TOOLBAR_DELETE_COL_TITLE',     cmd: deleteColumn   },
];

export const tableToolbarPlugin = $prose(() => new Plugin({
  key: new PluginKey('table-toolbar'),
  view(editorView) {
    const toolbar = document.createElement('div');
    toolbar.className = 'table-toolbar';

    TOOLBAR_ACTIONS.forEach(({ labelKey, titleKey, cmd }) => {
      const btn = document.createElement('button');
      btn.className = 'table-toolbar-btn';
      btn.textContent = t(labelKey);
      btn.title = t(titleKey);
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
        // Position just above the table, aligned to its right edge
        toolbar.style.top  = `${tableRect.top - containerRect.top - toolbar.offsetHeight - 4}px`;
        toolbar.style.left = `${tableRect.right - containerRect.left - toolbar.offsetWidth}px`;
      },
      destroy() {
        toolbar.remove();
      },
    };
  },
}));
