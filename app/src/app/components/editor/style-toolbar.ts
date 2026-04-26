/**
 * Description: Floating style toolbar that appears when text is selected in the editor.
 *   Shows Bold, Italic, Strikethrough, Code, Math, Link toggle buttons with active states.
 *   Modeled after Milkdown Crepe's toolbar feature using TooltipProvider.
 * Requirements: @milkdown/plugin-tooltip (TooltipProvider), @milkdown/preset-commonmark,
 *   @milkdown/preset-gfm, @milkdown/core (commandsCtx)
 * Inputs: Milkdown Ctx, EditorView, tooltipPlugin key
 * Outputs: Tooltip spec object { view: (view) => PluginView }
 */
import type { EditorState } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import { TooltipProvider } from '@milkdown/plugin-tooltip';
import { TextSelection } from '@milkdown/prose/state';
import { commandsCtx, editorViewCtx } from '@milkdown/core';
import {
  strongSchema,
  emphasisSchema,
  inlineCodeSchema,
  linkSchema,
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  isMarkSelectedCommand,
} from '@milkdown/preset-commonmark';
import {
  strikethroughSchema,
  toggleStrikethroughCommand,
} from '@milkdown/preset-gfm';
import { mathInlineSchema } from '@milkdown/plugin-math';

// ─── SVG icons (from Milkdown Crepe) ─────────────────────────────────────────

const boldIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M8.85758 18.625C8.4358 18.625 8.07715 18.4772 7.78163 18.1817C7.48613 17.8862 7.33838 17.5275 7.33838 17.1058V6.8942C7.33838 6.47242 7.48613 6.11377 7.78163 5.81825C8.07715 5.52275 8.4358 5.375 8.85758 5.375H12.1999C13.2191 5.375 14.1406 5.69231 14.9643 6.32693C15.788 6.96154 16.1999 7.81603 16.1999 8.89038C16.1999 9.63779 16.0194 10.2471 15.6585 10.7183C15.2976 11.1894 14.9088 11.5314 14.4922 11.7442C15.005 11.9211 15.4947 12.2708 15.9614 12.7933C16.428 13.3157 16.6614 14.0192 16.6614 14.9038C16.6614 16.182 16.1902 17.1217 15.2479 17.723C14.3056 18.3243 13.3563 18.625 12.3999 18.625H8.85758ZM9.4883 16.6327H12.3191C13.1063 16.6327 13.6627 16.4141 13.9884 15.9769C14.314 15.5397 14.4768 15.1205 14.4768 14.7192C14.4768 14.3179 14.314 13.8987 13.9884 13.4615C13.6627 13.0243 13.0909 12.8057 12.273 12.8057H9.4883V16.6327ZM9.4883 10.875H12.0826C12.6903 10.875 13.172 10.7013 13.5278 10.3539C13.8836 10.0064 14.0615 9.59037 14.0615 9.10575C14.0615 8.59035 13.8733 8.16918 13.497 7.84225C13.1207 7.51533 12.6595 7.35188 12.1133 7.35188H9.4883V10.875Z"/></svg>`;

const italicIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M6.29811 18.625C6.04505 18.625 5.83115 18.5375 5.65641 18.3626C5.48166 18.1877 5.39429 17.9736 5.39429 17.7203C5.39429 17.467 5.48166 17.2532 5.65641 17.0788C5.83115 16.9045 6.04505 16.8173 6.29811 16.8173H9.21159L12.452 7.18265H9.53851C9.28545 7.18265 9.07155 7.0952 8.89681 6.9203C8.72206 6.7454 8.63469 6.5313 8.63469 6.278C8.63469 6.02472 8.72206 5.81089 8.89681 5.63652C9.07155 5.46217 9.28545 5.375 9.53851 5.375H16.8847C17.1377 5.375 17.3516 5.46245 17.5264 5.63735C17.7011 5.81225 17.7885 6.02634 17.7885 6.27962C17.7885 6.53293 17.7011 6.74676 17.5264 6.92113C17.3516 7.09548 17.1377 7.18265 16.8847 7.18265H14.2789L11.0385 16.8173H13.6443C13.8973 16.8173 14.1112 16.9048 14.286 17.0797C14.4607 17.2546 14.5481 17.4687 14.5481 17.722C14.5481 17.9752 14.4607 18.1891 14.286 18.3634C14.1112 18.5378 13.8973 18.625 13.6443 18.625H6.29811Z"/></svg>`;

const strikethroughIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3.25 13.7404C3.0375 13.7404 2.85938 13.6684 2.71563 13.5246C2.57188 13.3808 2.5 13.2026 2.5 12.99C2.5 12.7774 2.57188 12.5993 2.71563 12.4558C2.85938 12.3122 3.0375 12.2404 3.25 12.2404H20.75C20.9625 12.2404 21.1406 12.3123 21.2843 12.4561C21.4281 12.5999 21.5 12.7781 21.5 12.9907C21.5 13.2033 21.4281 13.3814 21.2843 13.525C21.1406 13.6686 20.9625 13.7404 20.75 13.7404H3.25ZM10.9423 10.2596V6.62495H6.5673C6.2735 6.62495 6.02377 6.52201 5.8181 6.31613C5.61245 6.11026 5.50963 5.86027 5.50963 5.56615C5.50963 5.27205 5.61245 5.02083 5.8181 4.8125C6.02377 4.60417 6.2735 4.5 6.5673 4.5H17.4423C17.7361 4.5 17.9858 4.60294 18.1915 4.80883C18.3971 5.01471 18.5 5.2647 18.5 5.5588C18.5 5.85292 18.3971 6.10413 18.1915 6.31245C17.9858 6.52078 17.7361 6.62495 17.4423 6.62495H13.0673V10.2596H10.9423ZM10.9423 15.7211H13.0673V18.4423C13.0673 18.7361 12.9643 18.9858 12.7584 19.1915C12.5526 19.3971 12.3026 19.5 12.0085 19.5C11.7144 19.5 11.4631 19.3962 11.2548 19.1887C11.0465 18.9811 10.9423 18.7291 10.9423 18.4327V15.7211Z"/></svg>`;

const codeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M9.4 16.6L4.8 12L9.4 7.4L8 6L2 12L8 18L9.4 16.6ZM14.6 16.6L19.2 12L14.6 7.4L16 6L22 12L16 18L14.6 16.6Z"/></svg>`;

// Sigma icon for inline math
const mathIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M7 19v-.808L13.096 12L7 5.808V5h10v1.25H9.102L14.727 12l-5.625 5.77H17V19z"/></svg>`;

const linkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M17.0385 19.5003V16.5388H14.0769V15.0388H17.0385V12.0773H18.5384V15.0388H21.5V16.5388H18.5384V19.5003H17.0385ZM10.8077 16.5388H7.03845C5.78282 16.5388 4.7125 16.0963 3.8275 15.2114C2.9425 14.3266 2.5 13.2564 2.5 12.0009C2.5 10.7454 2.9425 9.67504 3.8275 8.78979C4.7125 7.90454 5.78282 7.46191 7.03845 7.46191H10.8077V8.96186H7.03845C6.1987 8.96186 5.48235 9.25834 4.8894 9.85129C4.29645 10.4442 3.99998 11.1606 3.99998 12.0003C3.99998 12.8401 4.29645 13.5564 4.8894 14.1494C5.48235 14.7423 6.1987 15.0388 7.03845 15.0388H10.8077V16.5388ZM8.25 12.7503V11.2504H15.75V12.7503H8.25ZM21.5 12.0003H20C20 11.1606 19.7035 10.4442 19.1106 9.85129C18.5176 9.25834 17.8013 8.96186 16.9615 8.96186H13.1923V7.46191H16.9615C18.2171 7.46191 19.2875 7.90441 20.1725 8.78939C21.0575 9.67439 21.5 10.7447 21.5 12.0003Z"/></svg>`;

// ─── Toolbar item definition ─────────────────────────────────────────────────

interface ToolbarItemDef {
  id: string;
  icon: string;
  isActive: (ctx: any) => boolean;
  onRun: (ctx: any) => void;
  group: number; // items in the same group are separated by dividers from other groups
}

function getToolbarItems(): ToolbarItemDef[] {
  return [
    {
      id: 'bold',
      icon: boldIcon,
      group: 0,
      isActive: (ctx) => {
        try {
          return ctx.get(commandsCtx).call(isMarkSelectedCommand.key, strongSchema.type(ctx));
        } catch { return false; }
      },
      onRun: (ctx) => ctx.get(commandsCtx).call(toggleStrongCommand.key),
    },
    {
      id: 'italic',
      icon: italicIcon,
      group: 0,
      isActive: (ctx) => {
        try {
          return ctx.get(commandsCtx).call(isMarkSelectedCommand.key, emphasisSchema.type(ctx));
        } catch { return false; }
      },
      onRun: (ctx) => ctx.get(commandsCtx).call(toggleEmphasisCommand.key),
    },
    {
      id: 'strikethrough',
      icon: strikethroughIcon,
      group: 0,
      isActive: (ctx) => {
        try {
          return ctx.get(commandsCtx).call(isMarkSelectedCommand.key, strikethroughSchema.type(ctx));
        } catch { return false; }
      },
      onRun: (ctx) => ctx.get(commandsCtx).call(toggleStrikethroughCommand.key),
    },
    {
      id: 'code',
      icon: codeIcon,
      group: 1,
      isActive: (ctx) => {
        try {
          return ctx.get(commandsCtx).call(isMarkSelectedCommand.key, inlineCodeSchema.type(ctx));
        } catch { return false; }
      },
      onRun: (ctx) => ctx.get(commandsCtx).call(toggleInlineCodeCommand.key),
    },
    {
      id: 'math',
      icon: mathIcon,
      group: 1,
      isActive: (_ctx) => false, // math inline is a node, not a mark — no toggle active state
      onRun: (ctx) => {
        // Wrap selected text in inline math ($...$) — inline math stores value as text children
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const { from, to } = state.selection;
        const text = state.doc.textBetween(from, to);
        const mathType = mathInlineSchema.type(ctx);
        const content = text ? state.schema.text(text) : undefined;
        const node = mathType.create({}, content);
        view.dispatch(state.tr.replaceWith(from, to, node));
        view.focus();
      },
    },
    {
      id: 'link',
      icon: linkIcon,
      group: 1,
      isActive: (ctx) => {
        try {
          return ctx.get(commandsCtx).call(isMarkSelectedCommand.key, linkSchema.type(ctx));
        } catch { return false; }
      },
      onRun: (ctx) => {
        // Toggle link: if selected text already has link mark, remove it; otherwise add with href
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const { from, to } = state.selection;
        const linkType = linkSchema.type(ctx);
        let hasLink = false;
        state.doc.nodesBetween(from, to, (node: any) => {
          if (linkType.isInSet(node.marks)) hasLink = true;
        });
        if (hasLink) {
          // Remove link mark from selection
          view.dispatch(state.tr.removeMark(from, to, linkType));
        } else {
          // Add link mark with empty href — the link tooltip plugin will handle editing
          const mark = linkType.create({ href: '' });
          view.dispatch(state.tr.addMark(from, to, mark));
        }
      },
    },
  ];
}

// ─── Tooltip spec creator ────────────────────────────────────────────────────

export function createStyleToolbarSpec(ctx: any) {
  const content = document.createElement('div');
  content.className = 'style-toolbar';
  content.dataset.show = 'false';

  const items = getToolbarItems();

  let provider: TooltipProvider | null = null;

  const renderButtons = () => {
    content.replaceChildren();
    let lastGroup = -1;
    for (const item of items) {
      // Divider between groups
      if (lastGroup >= 0 && item.group !== lastGroup) {
        const divider = document.createElement('div');
        divider.className = 'style-toolbar-divider';
        content.appendChild(divider);
      }
      lastGroup = item.group;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'style-toolbar-btn';
      btn.dataset.id = item.id;
      btn.innerHTML = item.icon;

      // Check active state
      try {
        if (item.isActive(ctx)) btn.classList.add('active');
      } catch { /* ignore if editor not ready */ }

      // Use pointerdown to prevent losing text selection
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.onRun(ctx);
        // Re-render active states after toggling
        requestAnimationFrame(() => renderButtons());
      });

      content.appendChild(btn);
    }
  };

  return {
    view: (view: EditorView) => {
      provider = new TooltipProvider({
        content,
        debounce: 20,
        offset: 10,
        shouldShow(view: EditorView) {
          const { doc, selection } = view.state;
          const { empty, from, to } = selection;

          if (!(selection instanceof TextSelection)) return false;
          if (empty) return false;
          if (!doc.textBetween(from, to).length) return false;
          if (!view.hasFocus()) return false;
          if (!view.editable) return false;

          return true;
        },
      });

      provider.onShow = () => {
        content.dataset.show = 'true';
        renderButtons();
      };
      provider.onHide = () => {
        content.dataset.show = 'false';
      };

      provider.update(view);

      return {
        update: (nextView: EditorView, prevState?: EditorState) => {
          provider?.update(nextView, prevState);
        },
        destroy: () => {
          provider?.destroy();
          content.remove();
          provider = null;
        },
      };
    },
  };
}
