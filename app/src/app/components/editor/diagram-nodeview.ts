/**
 * Description: Creates a Milkdown plugin that renders mermaid diagrams as SVG.
 *   The @milkdown/plugin-diagram v7 only defines node schema (parse/serialize) without
 *   a rendering NodeView. This uses $prose to inject a ProseMirror plugin with nodeViews
 *   that call mermaid.render() for SVG output.
 * Requirements: @milkdown/utils ($prose), mermaid
 * Inputs: none (reads diagram node type from ProseMirror schema)
 * Outputs: MilkdownPlugin providing mermaid SVG rendering as NodeView
 */
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { NodeViewConstructor } from '@milkdown/prose/view';
import mermaid from 'mermaid';

/** Counter for unique render IDs to avoid mermaid collisions */
let renderCounter = 0;
let mermaidInitialized = false;

function ensureMermaidInitialized() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    flowchart: { useMaxWidth: false },
  });
  mermaidInitialized = true;
}

function createMermaidNodeView(): NodeViewConstructor {
  return (node, view, getPos) => {
    let currentNode = node;
    let identity = node.attrs.identity || `mermaid-${++renderCounter}`;
    let code = node.attrs.value || '';
    let editing = false;
    let textarea: HTMLTextAreaElement | null = null;

    const dom = document.createElement('div');
    dom.dataset.type = 'diagram';
    dom.dataset.id = identity;
    dom.dataset.value = code;
    dom.contentEditable = 'false';
    dom.className = 'mermaid-diagram-wrapper';
    dom.style.cssText = 'margin: 8px 0; text-align: center;';

    const updateDiagramNode = (value: string) => {
      if (typeof getPos !== 'function') return;
      const pos = getPos();
      if (typeof pos !== 'number') return;
      view.dispatch(
        view.state.tr
          .setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            identity,
            value,
          })
          .scrollIntoView()
      );
    };

    async function renderDiagram(source: string) {
      if (!source.trim()) {
        dom.replaceChildren();
        return;
      }
      try {
        ensureMermaidInitialized();
        const id = `mermaid-svg-${identity}-${++renderCounter}`;
        const { svg } = await mermaid.render(id, source);
        dom.innerHTML = svg;
        const svgEl = dom.querySelector('svg');
        if (svgEl) {
          const viewBox = svgEl.getAttribute('viewBox')?.split(/\s+/).map(Number);
          const vbWidth = viewBox?.[2];
          const vbHeight = viewBox?.[3];
          if (vbWidth && vbHeight) {
            svgEl.setAttribute('width', `${vbWidth}`);
            svgEl.setAttribute('height', `${vbHeight}`);
          }
          svgEl.style.width = 'auto';
          svgEl.style.maxWidth = '100%';
          svgEl.style.height = 'auto';
        }
      } catch {
        // Show raw code on render failure
        dom.textContent = source;
      }
    }

    const renderStatic = () => {
      editing = false;
      textarea = null;
      dom.dataset.id = identity;
      dom.dataset.value = code;
      dom.title = 'Double-click to edit Mermaid diagram';
      renderDiagram(code);
    };

    const commitEdit = (nextCode: string) => {
      editing = false;
      textarea = null;
      if (nextCode !== code) {
        code = nextCode;
        updateDiagramNode(nextCode);
      } else {
        renderStatic();
        view.focus();
      }
    };

    const startEditing = () => {
      if (editing) return;
      editing = true;
      const input = document.createElement('textarea');
      textarea = input;
      input.value = code;
      input.className = 'mermaid-diagram-editor';
      input.spellcheck = false;
      input.placeholder = 'graph TD;\n  A[Start] --> B[Next]';
      input.setAttribute('aria-label', 'Mermaid diagram source');
      input.style.cssText = [
        'display:block',
        'width:100%',
        'min-height:160px',
        'padding:12px',
        'border-radius:10px',
        'border:1px solid var(--border-primary, #4c566a)',
        'background:var(--editor-code-bg, #222)',
        'color:var(--editor-fg, #ccc)',
        'font:13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
        'resize:vertical',
        'white-space:pre',
      ].join(';');

      input.addEventListener('blur', () => commitEdit(input.value));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          editing = false;
          renderStatic();
          view.focus();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          commitEdit(input.value);
        }
      });

      dom.replaceChildren(input);
      queueMicrotask(() => input.focus());
    };

    dom.addEventListener('dblclick', (event) => {
      event.preventDefault();
      startEditing();
    });

    renderStatic();
    if (!code.trim()) {
      queueMicrotask(startEditing);
    }

    return {
      dom,
      update(newNode) {
        if (newNode.type.name !== 'diagram') return false;
        currentNode = newNode;
        const newCode = newNode.attrs.value || '';
        identity = newNode.attrs.identity || identity;
        if (!editing && (newCode !== code || identity !== dom.dataset.id)) {
          code = newCode;
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
        return editing || event.type === 'dblclick' || !!(event.target as HTMLElement)?.closest('textarea');
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

/** Milkdown plugin that provides a NodeView for mermaid diagram nodes. */
export const diagramNodeViewPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey('mermaid-diagram-view'),
    props: {
      nodeViews: {
        diagram: createMermaidNodeView(),
      },
    },
  });
});
