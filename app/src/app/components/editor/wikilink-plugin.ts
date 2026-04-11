/**
 * Description: Milkdown wikilink plugin for [[target]] and [[target|alias]] syntax.
 *   Provides an input rule so typing [[...]] immediately creates a clickable link.
 *   Includes pre/post-processing helpers to convert wikilinks ↔ markdown links on load/save.
 * Requirements: @milkdown/utils, @milkdown/prose/inputrules
 * Inputs: markdown content strings; ProseMirror state via input rule
 * Outputs: transformed markdown strings; Milkdown plugin for editor registration
 */
import { $inputRule, $prose } from '@milkdown/utils';
import { InputRule } from '@milkdown/prose/inputrules';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { open } from '@tauri-apps/plugin-shell';

export const WIKILINK_PREFIX = 'wikilink://';
const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/;

/**
 * Replace Unicode characters that break Milkdown's remark parser with safe placeholders.
 * ✔ (U+2714 Heavy Check Mark) inside code fences triggers a ProseMirror schema error.
 */
const UNICODE_MAP: [RegExp, string][] = [
  [/✔/g, '{{u2714}}'],
];

export const preprocessUnicode = (content: string): string => {
  for (const [pattern, placeholder] of UNICODE_MAP) {
    content = content.replace(pattern, placeholder);
  }
  return content;
};

export const postprocessUnicode = (md: string): string => {
  md = md.replace(/\{\{u2714\}\}/g, '✔');
  return md;
};

/** Unescape underscores in markdown link text and URLs: [some\_text](some\_url) → [some_text](some_url).
 *  remark-stringify over-eagerly escapes _ inside links; CommonMark doesn't require it in destinations,
 *  and in a WYSIWYG editor the user never types raw escapes so they shouldn't appear in link text either. */
export const unescapeLinkUrls = (md: string): string =>
  md.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_m, text, url) =>
    `[${(text as string).replace(/\\_/g, '_')}](${(url as string).replace(/\\_/g, '_')})`);

/** On load: convert [[target]] / [[target|alias]] to markdown links so Milkdown renders them as clickable. */
export const preprocessWikilinks = (content: string): string =>
  content
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, target, alias) => `[${alias}](${WIKILINK_PREFIX}${target})`)
    .replace(/\[\[([^\]]+)\]\]/g, (_, target) => `[${target}](${WIKILINK_PREFIX}${target})`);

/** On save: convert wikilink markdown links and any escaped \[\[...\]\] back to [[...]] syntax. */
export const postprocessWikilinks = (md: string): string => {
  // Unescape \[\[content\]\] produced by remark-stringify for typed (non-rule) wikilinks
  md = md.replace(/\\\[\\\[([^\\]+)\\\]\\\]/g, '[[$1]]');
  // Convert [text](wikilink://target) → [[target]] or [[target|text]]
  md = md.replace(/\[([^\]]+)\]\(wikilink:\/\/([^)]+)\)/g, (_, text, target) =>
    text === target ? `[[${target}]]` : `[[${target}|${text}]]`
  );
  return md;
};

/**
 * Milkdown input rule: converts [[target]] or [[target|alias]] typed in the editor
 * into a real link mark with href="wikilink://target" so it's immediately clickable.
 */
export const wikilinkInputRule = $inputRule((ctx) =>
  new InputRule(WIKILINK_PATTERN, (state, match, start, end) => {
    const target = match[1];
    const alias = match[2];
    const displayText = alias || target;
    const href = `${WIKILINK_PREFIX}${target}`;

    const linkMark = state.schema.marks['link'];
    if (!linkMark) return null;

    const mark = linkMark.create({ href, title: null });
    return state.tr.replaceWith(start, end, state.schema.text(displayText, [mark]));
  })
);

/**
 * ProseMirror plugin: intercepts clicks on ALL <a> elements before the tooltip
 * plugin can show its link-edit popup. Dispatches a 'link-navigate' CustomEvent
 * on the editor DOM so the app can handle navigation immediately —
 * no need to wait for enhanceEditor() to attach onclick handlers.
 */
export const linkClickHandler = $prose(() =>
  new Plugin({
    key: new PluginKey('link-click'),
    props: {
      handleClick(view, _pos, event) {
        const target = event.target as HTMLElement;
        const anchor = target.closest('a');
        if (!anchor) return false;
        // Fall back to anchor text if href is empty but text looks like a URL
        let href = anchor.getAttribute('href') ?? '';
        if (!href) {
          const text = (anchor.textContent ?? '').trim();
          if (/^https?:\/\//.test(text) || /^[a-z0-9-]+(\.[a-z]{2,}){1,}(\/|$)/i.test(text)) {
            href = text.startsWith('http') ? text : `https://${text}`;
          } else {
            return false;
          }
        }

        event.preventDefault();
        event.stopPropagation();

        // Open external links directly (no dependency on enhanceEditor timing)
        const isExternal = href.startsWith('http') && !href.includes('localhost');
        if (isExternal) {
          open(href);
        } else {
          // Internal/wikilinks: dispatch event for app-level handler
          anchor.dispatchEvent(
            new CustomEvent('link-navigate', { bubbles: true, detail: { href } })
          );
        }
        return true;
      }
    }
  })
);
