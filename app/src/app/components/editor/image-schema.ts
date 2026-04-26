/**
 * Description: Overrides the commonmark `image` node schema to support a `width` attribute
 *   (pixels). When width is set, the image serializes to portable raw HTML
 *   `<img src alt width />`; when unset, it falls back to standard `![alt](src "title")`.
 *   Also provides a remark preprocessor that parses `<img>` HTML nodes in incoming
 *   markdown into image mdast with a width extra field, so round-trips work.
 *   Scheme from docs/plans/2026-04-21-editor-paste-image-to-file.md (Path C / §13 extension).
 * Requirements: @milkdown/utils ($nodeSchema, $remark), @milkdown/exception, unist-util-visit.
 * Inputs: mdast from remark-parse; image nodes from ProseMirror schema.
 * Outputs: image node schema with width attr; remark plugin for HTML <img> ingestion.
 */
import { $nodeSchema, $remark } from '@milkdown/utils';

// Tiny tree walker — replaces `unist-util-visit` so we don't add a dep for a 4-line function.
// Visits all nodes of the given type and calls visitor on each; mutation-in-place is supported.
function visitHtmlNodes(tree: any, visitor: (node: any) => void): void {
  if (!tree || typeof tree !== 'object') return;
  if (tree.type === 'html') visitor(tree);
  if (Array.isArray(tree.children)) {
    for (const child of tree.children) visitHtmlNodes(child, visitor);
  }
}

// Parse only simple self-contained <img> tags. Multi-line or complex HTML passes through untouched.
// Captures the attribute list so attr-level parsing runs against a small string.
const IMG_TAG_RE = /^<img\s+([^>]*?)\/?>\s*$/i;
const ATTR_RE = /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

function parseImgAttrs(attrStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrStr)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    out[name] = value;
  }
  return out;
}

/** HTML-escape a string for use inside an attribute value. */
function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseWidth(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Replacement for commonmark's image schema. Adds `width` attr and custom (de)serialization.
 * Priority 100 > commonmark default so this registration wins the name 'image' in the
 * merged schema.
 */
export const imageSchemaWithWidth = $nodeSchema('image', () => ({
  inline: true,
  group: 'inline',
  selectable: true,
  draggable: true,
  marks: '',
  atom: true,
  defining: true,
  isolating: true,
  priority: 100,
  attrs: {
    src: { default: '', validate: 'string' },
    alt: { default: '', validate: 'string' },
    title: { default: '', validate: 'string' },
    // null = no explicit width (clean ![]() serialization). Number = pixels (HTML serialization).
    width: { default: null },
  },
  parseDOM: [
    {
      tag: 'img[src]',
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) {
          throw new Error('Expected HTMLElement when parsing <img>');
        }
        return {
          src: dom.getAttribute('src') || '',
          alt: dom.getAttribute('alt') || '',
          title: dom.getAttribute('title') || '',
          width: parseWidth(dom.getAttribute('width') || undefined),
        };
      },
    },
  ],
  toDOM: (node) => {
    const attrs: Record<string, string> = { src: node.attrs.src };
    if (node.attrs.alt) attrs.alt = node.attrs.alt;
    if (node.attrs.title) attrs.title = node.attrs.title;
    if (node.attrs.width != null) attrs.width = String(node.attrs.width);
    return ['img', attrs];
  },
  parseMarkdown: {
    match: ({ type }) => type === 'image',
    runner: (state, node, type) => {
      // `width` is an mdast extra field we inject via the remarkImageWidthPlugin when
      // incoming HTML <img> is converted to a markdown image node.
      const url = node.url as string;
      const alt = (node.alt as string) || '';
      const title = (node.title as string) || '';
      const width = parseWidth((node as { width?: string }).width);
      state.addNode(type, { src: url, alt, title, width });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'image',
    runner: (state, node) => {
      const width = node.attrs.width as number | null;
      if (width != null && width > 0) {
        // Portable path: raw HTML `<img>` survives round-trips to GitHub, Obsidian,
        // mdBook, etc. remark-stringify passes `html` mdast nodes through verbatim.
        const src = escAttr(node.attrs.src as string);
        const alt = escAttr((node.attrs.alt as string) || '');
        const html = `<img src="${src}" alt="${alt}" width="${width}" />`;
        state.addNode('html', undefined, html);
        return;
      }
      // Clean path when no width: plain `![alt](src "title")`.
      state.addNode('image', undefined, undefined, {
        title: node.attrs.title,
        url: node.attrs.src,
        alt: node.attrs.alt,
      });
    },
  },
}));

/**
 * Remark preprocessor: rewrite `<img ...>` HTML nodes in the incoming mdast into
 * `image` nodes carrying a `width` extra field. Without this, HTML `<img>` in a
 * markdown file would stay as opaque raw HTML and our schema would never see the
 * width. We only rewrite `<img>` inline HTML — other HTML (divs, etc.) passes through.
 */
export const remarkImageWidthPlugin = $remark('remark-image-width', () => () => (tree) => {
  visitHtmlNodes(tree, (node: any) => {
    const match = IMG_TAG_RE.exec(String(node.value ?? '').trim());
    if (!match) return;
    const attrs = parseImgAttrs(match[1]);
    if (!attrs.src) return;
    // Mutate in place — rewriting type/fields preserves tree structure.
    node.type = 'image';
    node.url = attrs.src;
    node.alt = attrs.alt ?? '';
    node.title = attrs.title ?? '';
    (node as { width?: string }).width = attrs.width;
    delete node.value;
  });
});
