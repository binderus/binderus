/**
 * Description: Creates Milkdown node views backed by MathLive for inline and block math.
 *   We keep Milkdown's math schema/markdown support, but replace the deprecated KaTeX-only
 *   rendering path with MathLive static renderers and on-demand math-field editing.
 * Requirements: @milkdown/utils ($prose), mathlive
 * Inputs: none (reads math nodes from the ProseMirror schema)
 * Outputs: MilkdownPlugin providing NodeViews for `math_inline` and `math_block`
 */
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { Node as ProseMirrorNode } from '@milkdown/prose/model';
import type { EditorView, NodeView, NodeViewConstructor } from '@milkdown/prose/view';
import 'mathlive';
import 'mathlive/static.css';

type MathFieldEl = HTMLElement & {
  value: string;
  readOnly: boolean;
  defaultMode: 'inline-math' | 'math' | 'text';
  menuItems?: readonly unknown[];
  focus: () => void;
};

type StaticMathEl = HTMLElement & {
  mode: 'textstyle' | 'displaystyle';
  render?: () => void;
};

type MathMode = 'inline' | 'block';

const MULTILINE_ENVIRONMENTS = new Set([
  'aligned',
  'align',
  'align*',
  'alignat',
  'alignat*',
  'gather',
  'gather*',
  'multline',
  'multline*',
  'cases',
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
]);

function readMathValue(node: ProseMirrorNode, mode: MathMode): string {
  return mode === 'inline' ? node.textContent : String(node.attrs.value ?? '');
}

function normalizeBlockMathValue(source: string): string {
  const match = source.match(/^\\begin\{([a-zA-Z*]+)\}\n([\s\S]*)\n\\end\{\1\}$/);
  if (!match) return source;

  const [, env, body] = match;
  if (!MULTILINE_ENVIRONMENTS.has(env)) return source;

  const lines = body.split('\n');
  if (lines.length < 2) return source;
  if (lines.some((line, index) => index < lines.length - 1 && /\\\\\s*$/.test(line))) return source;

  const nextBody = lines
    .map((line, index) => (index < lines.length - 1 && line.trim() !== '' ? `${line} \\\\` : line))
    .join('\n');

  return `\\begin{${env}}\n${nextBody}\n\\end{${env}}`;
}

function getNodePos(getPos: boolean | (() => number | undefined)): number | null {
  if (typeof getPos !== 'function') return null;
  const pos = getPos();
  return typeof pos === 'number' && Number.isFinite(pos) ? pos : null;
}

function isEditorEditable(view: EditorView): boolean {
  const editable = (view as any).props?.editable;
  return typeof editable === 'function' ? editable(view.state) : true;
}

function createStaticMathElement(mode: MathMode, value: string): StaticMathEl {
  const el = document.createElement(mode === 'inline' ? 'math-span' : 'math-div') as StaticMathEl;
  el.mode = mode === 'inline' ? 'textstyle' : 'displaystyle';
  el.textContent = mode === 'block' ? normalizeBlockMathValue(value) : value;
  el.render?.();
  return el;
}

function createMathField(mode: MathMode, value: string): MathFieldEl {
  const field = document.createElement('math-field') as MathFieldEl;
  field.value = mode === 'block' ? normalizeBlockMathValue(value) : value;
  field.readOnly = false;
  field.defaultMode = 'math';
  field.setAttribute('smart-fence', 'on');
  field.setAttribute('smart-mode', 'off');
  field.setAttribute('virtual-keyboard-mode', 'manual');
  field.setAttribute('popover-policy', 'auto');
  field.setAttribute('remove-extraneous-parentheses', 'off');
  field.setAttribute('letter-shape-style', 'tex');
  return field;
}

function updateInlineMathNode(view: EditorView, node: ProseMirrorNode, getPos: boolean | (() => number | undefined), value: string) {
  const pos = getNodePos(getPos);
  if (pos == null) return;

  const content = value ? view.state.schema.text(value) : undefined;
  const replacement = node.type.create(node.attrs, content, node.marks);
  view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, replacement).scrollIntoView());
}

function updateBlockMathNode(view: EditorView, node: ProseMirrorNode, getPos: boolean | (() => number | undefined), value: string) {
  const pos = getNodePos(getPos);
  if (pos == null) return;

  view.dispatch(
    view.state.tr
      .setNodeMarkup(pos, undefined, { ...node.attrs, value })
      .scrollIntoView()
  );
}

function createMathNodeView(mode: MathMode): NodeViewConstructor {
  return (node, view, getPos): NodeView => {
    let currentNode = node;
    let currentValue = readMathValue(node, mode);
    let editing = false;
    let field: MathFieldEl | null = null;

    const dom = document.createElement(mode === 'inline' ? 'span' : 'div');
    dom.dataset.type = mode === 'inline' ? 'math_inline' : 'math_block';
    dom.contentEditable = 'false';
    dom.className = `mathlive-nodeview mathlive-nodeview--${mode}`;

    const renderStatic = () => {
      editing = false;
      field = null;
      dom.replaceChildren(createStaticMathElement(mode, currentValue));
      if (isEditorEditable(view)) {
        dom.title = mode === 'inline' ? 'Double-click to edit formula' : 'Double-click to edit math block';
      } else {
        dom.removeAttribute('title');
      }
    };

    const commitEdit = (nextValue: string) => {
      const normalizedValue = mode === 'block' ? normalizeBlockMathValue(nextValue) : nextValue;
      editing = false;
      field = null;

      if (normalizedValue !== currentValue) {
        if (mode === 'inline') {
          updateInlineMathNode(view, currentNode, getPos, normalizedValue);
        } else {
          updateBlockMathNode(view, currentNode, getPos, normalizedValue);
        }
        currentValue = normalizedValue;
      }

      renderStatic();
      view.focus();
    };

    const startEditing = () => {
      if (editing || !isEditorEditable(view)) return;
      editing = true;
      field = createMathField(mode, currentValue);
      dom.replaceChildren(field);

      field.addEventListener('change', () => {
        if (!field) return;
        commitEdit(field.value);
      });

      field.addEventListener('blur', () => {
        if (!field) return;
        commitEdit(field.value);
      });

      field.addEventListener('keydown', (event: KeyboardEvent) => {
        if (!field) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          editing = false;
          renderStatic();
          view.focus();
          return;
        }

        if (mode === 'inline' && event.key === 'Enter') {
          event.preventDefault();
          commitEdit(field.value);
          return;
        }

        if (mode === 'block' && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          commitEdit(field.value);
        }
      });

      queueMicrotask(() => field?.focus());
    };

    dom.addEventListener('dblclick', (event) => {
      event.preventDefault();
      startEditing();
    });

    renderStatic();
    if (mode === 'block' && currentValue.trim() === '' && isEditorEditable(view)) {
      queueMicrotask(startEditing);
    }

    return {
      dom,
      update(newNode) {
        if (newNode.type.name !== (mode === 'inline' ? 'math_inline' : 'math_block')) return false;
        currentNode = newNode;
        currentValue = readMathValue(newNode, mode);
        if (!editing) {
          renderStatic();
        }
        return true;
      },
      selectNode() {
        dom.classList.add('ProseMirror-selectednode');
      },
      deselectNode() {
        dom.classList.remove('ProseMirror-selectednode');
      },
      stopEvent(event) {
        return editing || event.type === 'dblclick' || !!(event.target as HTMLElement)?.closest('math-field');
      },
      ignoreMutation() {
        return true;
      },
      destroy() {
        dom.remove();
      },
    };
  };
}

/** Milkdown plugin that provides MathLive-backed node views for math nodes. */
export const mathNodeViewPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey('milkdown-mathlive-view'),
    props: {
      nodeViews: {
        math_inline: createMathNodeView('inline'),
        math_block: createMathNodeView('block'),
      },
    },
  });
});
