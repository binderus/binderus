/**
 * Description: Creates a Milkdown plugin that renders a language selector dropdown
 *   for code_block nodes. Milkdown v7 removed this built-in UI; this restores it
 *   using $prose with a custom NodeView that wraps ProseMirror-managed content.
 * Requirements: @milkdown/utils ($prose), @milkdown/prose/state, @milkdown/prose/view
 * Inputs: none (reads code_block node type from ProseMirror schema)
 * Outputs: MilkdownPlugin providing a language selector dropdown on code blocks
 */
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { NodeViewConstructor } from '@milkdown/prose/view';

const LANGUAGES = [
  '', 'bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'docker', 'go',
  'html', 'java', 'javascript', 'json', 'jsx', 'kotlin', 'markdown',
  'php', 'python', 'ruby', 'rust', 'sql', 'swift', 'toml', 'tsx',
  'typescript', 'xml', 'yaml',
];

function createCodeBlockNodeView(): NodeViewConstructor {
  return (node, view, getPos) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-fence';

    // Language selector — contentEditable=false keeps it outside ProseMirror's editable area
    const selectorWrapper = document.createElement('div');
    selectorWrapper.className = 'code-fence_selector-wrapper';
    selectorWrapper.contentEditable = 'false';

    const selector = document.createElement('select');
    selector.className = 'code-fence_selector';

    LANGUAGES.forEach((lang) => {
      const option = document.createElement('option');
      option.value = lang;
      option.textContent = lang || 'Plain Text';
      selector.appendChild(option);
    });

    selector.value = node.attrs.language || '';

    selector.addEventListener('mousedown', (e) => e.stopPropagation());
    selector.addEventListener('change', () => {
      if (typeof getPos !== 'function') return;
      const pos = getPos();
      if (typeof pos !== 'number') return;
      view.dispatch(view.state.tr.setNodeAttribute(pos, 'language', selector.value));
    });

    selectorWrapper.appendChild(selector);

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    pre.appendChild(code);

    wrapper.appendChild(selectorWrapper);
    wrapper.appendChild(pre);

    return {
      dom: wrapper,
      contentDOM: code,
      update(newNode) {
        if (newNode.type.name !== 'code_block') return false;
        if (newNode.attrs.language !== selector.value) {
          selector.value = newNode.attrs.language || '';
        }
        return true;
      },
      stopEvent(event) {
        // Let ProseMirror ignore events coming from the selector dropdown
        const target = event.target as HTMLElement;
        return !!target?.closest('.code-fence_selector-wrapper');
      },
      ignoreMutation(mutation) {
        // Only track mutations inside contentDOM; ignore selector/wrapper changes
        return !(code === mutation.target || code.contains(mutation.target));
      },
      destroy() {
        wrapper.remove();
      },
    };
  };
}

/** Milkdown plugin that provides a language selector NodeView for code_block nodes. */
export const codeBlockNodeViewPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey('code-block-language-selector'),
    props: {
      nodeViews: {
        code_block: createCodeBlockNodeView(),
      },
    },
  });
});
