/**
 * Description: Two Milkdown plugins for link handling.
 *   1. linkInputRule — converts typed [label](url) into a real hyperlink mark.
 *   2. linkTooltipPlugin — floating popover shown when cursor is inside a link;
 *      displays the URL with Open / Edit actions. Edit mode shows label + URL inputs.
 * Requirements: @milkdown/utils ($inputRule, $prose), @milkdown/prose/inputrules,
 *   @milkdown/prose/state, @milkdown/preset-commonmark (linkSchema)
 * Inputs: none (reacts to ProseMirror doc / selection state)
 * Outputs: two MilkdownPlugins
 */
import { $inputRule, $prose } from '@milkdown/utils';
import { InputRule } from '@milkdown/prose/inputrules';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { linkSchema } from '@milkdown/preset-commonmark';

// ─── 1. Input rule: [label](url) → link mark ─────────────────────────────────

export const linkInputRule = $inputRule((ctx) =>
  new InputRule(
    // Fire on closing ')' of [label](url)
    /\[(.+?)\]\(([^)]+)\)$/,
    (state, match, start, end) => {
      const [, label, href] = match;
      if (!label || !href) return null;
      const mark = linkSchema.type(ctx).create({ href, title: '' });
      return state.tr.replaceWith(start, end, state.schema.text(label, [mark]));
    }
  )
);

// ─── 2. Link tooltip plugin ───────────────────────────────────────────────────

type LinkRange = { start: number; end: number; href: string; text: string };

/** Returns link mark info if the cursor (empty selection) is inside a link. */
function getLinkAtCursor(state: any): LinkRange | null {
  const { $from, empty } = state.selection;
  if (!empty) return null;

  // Check marks at cursor; fall back to one position before (end-of-link edge)
  const pos = $from.pos > $from.start(1) ? $from.pos - 1 : $from.pos;
  const marks: any[] = state.doc.resolve(pos).marks();
  const linkMark = marks.find((m: any) => m.type.name === 'link');
  if (!linkMark) return null;

  const { doc } = state;
  const blockStart = $from.start(1);
  const blockEnd   = $from.end(1);

  // Walk left from cursor to find mark start
  let start = $from.pos;
  while (start > blockStart) {
    const prevMarks: any[] = doc.resolve(start - 1).marks();
    if (!prevMarks.some((m: any) => m.type === linkMark.type && m.attrs.href === linkMark.attrs.href)) break;
    start--;
  }
  // Walk right from cursor to find mark end
  let end = $from.pos;
  while (end < blockEnd) {
    const nextMarks: any[] = doc.resolve(end).marks();
    if (!nextMarks.some((m: any) => m.type === linkMark.type && m.attrs.href === linkMark.attrs.href)) break;
    end++;
  }

  return { start, end, href: linkMark.attrs.href as string, text: doc.textBetween(start, end) };
}

export const linkTooltipPlugin = $prose((ctx) =>
  new Plugin({
    key: new PluginKey('link-tooltip'),
    view(editorView) {
      // ── DOM structure ──────────────────────────────────────────────────────
      const tooltip = document.createElement('div');
      tooltip.className = 'link-tooltip';

      const urlRow = document.createElement('div');
      urlRow.className = 'link-tooltip-url-row';

      const urlText = document.createElement('span');
      urlText.className = 'link-tooltip-url';

      const openBtn = makeBtn('↗', 'Open link in browser');
      const editBtn = makeBtn('✎', 'Edit link');
      urlRow.append(urlText, openBtn, editBtn);

      const form = document.createElement('div');
      form.className = 'link-tooltip-form';
      form.style.display = 'none';

      const labelInput = makeInput('Label');
      const urlInput   = makeInput('URL');
      const saveBtn    = makeBtn('Save', 'Save changes');
      saveBtn.className += ' link-tooltip-save';
      form.append(labelInput, urlInput, saveBtn);

      tooltip.append(urlRow, form);

      // Append to body so ProseMirror never intercepts clicks on the tooltip
      document.body.appendChild(tooltip);

      let current: LinkRange | null = null;
      let isHovered = false;

      const hide = () => {
        tooltip.style.display = 'none';
        form.style.display = 'none';
        isHovered = false;
        // Don't clear current here — applyEdit still needs it after hide
      };
      hide();

      // Track hover so update() doesn't hide while user moves mouse to tooltip
      tooltip.addEventListener('mouseenter', () => { isHovered = true; });
      tooltip.addEventListener('mouseleave', () => { isHovered = false; });

      // ── Actions ────────────────────────────────────────────────────────────
      openBtn.addEventListener('click', () => {
        const href = current?.href;
        if (href) window.open(href, '_blank', 'noopener');
      });

      editBtn.addEventListener('click', () => {
        // current was captured before the click; safe to use it here
        const snap = current;
        if (!snap) return;
        labelInput.value = snap.text;
        urlInput.value   = snap.href;
        form.style.display = 'flex';
        setTimeout(() => urlInput.focus(), 0);
      });

      saveBtn.addEventListener('click', () => applyEdit());
      [labelInput, urlInput].forEach((inp) =>
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); applyEdit(); }
          if (e.key === 'Escape') { e.preventDefault(); editorView.focus(); hide(); }
        })
      );

      function applyEdit() {
        if (!current) return;
        const newLabel = labelInput.value.trim();
        const newHref  = urlInput.value.trim();
        if (!newHref) return;

        const { state, dispatch } = editorView;
        // Re-read current range at the stored position in case doc changed
        const { start, end, text, href } = current;
        let tr = state.tr;

        if (newLabel && newLabel !== text) {
          // Replace text + mark in one step
          const mark = linkSchema.type(ctx).create({ href: newHref });
          tr = tr.replaceWith(start, end, state.schema.text(newLabel, [mark]));
        } else if (newHref !== href) {
          // Only href changed — swap mark attrs
          const oldMark = state.doc.resolve(start).marks().find((m: any) => m.type.name === 'link');
          if (oldMark) {
            const newMark = linkSchema.type(ctx).create({ href: newHref });
            tr = tr.removeMark(start, end, oldMark).addMark(start, end, newMark);
          }
        }

        dispatch(tr.scrollIntoView());
        editorView.focus();
        hide();
      }

      // ── PluginView ─────────────────────────────────────────────────────────
      return {
        update(view) {
          // Don't hide while user is hovering over tooltip or editing inputs
          if (isHovered || tooltip.contains(document.activeElement)) {
            // Still refresh current so applyEdit gets fresh positions
            const info = getLinkAtCursor(view.state);
            if (info) current = info;
            return;
          }

          const linkInfo = getLinkAtCursor(view.state);
          if (!linkInfo) { hide(); return; }

          current = linkInfo;
          urlText.textContent = linkInfo.href;

          // coordsAtPos returns viewport-relative coords — correct for position:fixed
          const { from } = view.state.selection;
          const coords = view.coordsAtPos(from);
          tooltip.style.display = 'block';
          tooltip.style.top = `${coords.bottom + 6}px`;
          // Clamp left so the tooltip never overflows the right edge of the viewport
          const tipWidth = tooltip.offsetWidth || 320;
          const clampedLeft = Math.min(coords.left, window.innerWidth - tipWidth - 8);
          tooltip.style.left = `${Math.max(clampedLeft, 8)}px`;
        },
        destroy() { tooltip.remove(); },
      };
    },
  })
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBtn(text: string, title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  btn.title = title;
  btn.className = 'link-tooltip-btn';
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  return btn;
}

function makeInput(placeholder: string): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = placeholder;
  inp.className = 'link-tooltip-input';
  return inp;
}
