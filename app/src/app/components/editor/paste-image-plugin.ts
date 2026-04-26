/**
 * Description: ProseMirror plugin that intercepts Cmd/Ctrl+V with an image on the clipboard
 *   (and image drag-drops) and saves the image to the vault as a file, inserting a relative
 *   markdown link like ![](_images/YYYY-MM-DD/<hash>.png). Also registers a node view that
 *   resolves relative image src values to asset:// URLs at render time. Fail-closed per
 *   docs/plans/2026-04-21-editor-paste-image-to-file.md §7.2 — never base64.
 * Requirements: @milkdown/utils ($prose), @milkdown/prose/state, @milkdown/prose/view,
 *   react-toastify via ../toaster/toaster, react-intl-universal via base-utils.
 * Inputs: ClipboardEvent / DragEvent intercepted by ProseMirror.
 * Outputs: MilkdownPlugin; inserts image node on success; shows error toast on failure.
 */
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { EditorView, NodeViewConstructor } from '@milkdown/prose/view';
import {
  saveImageToVault,
  resolveImageSrc,
  deleteImageFromVault,
  absFilePathFromRel,
  isDbMode,
  hashFromRelPath,
  MAX_PASTE_IMAGE_BYTES,
  type SaveImageErrorCode,
} from '../../utils/image-utils';
import { splitFilePath, t } from '../../utils/base-utils';
import { toastError } from '../toaster/toaster';
import { showAlert, showConfirm } from '../confirm-dialog/confirm-dialog';
import { showImagePreview } from '../image-preview-overlay/image-preview-overlay';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../hooks/use-app-store';
import { moveFiles } from '../../utils/tauri-utils';
import { showFolderPicker } from '../modal/folder-picker-host';

// --- Move-image helpers (used by toolbar's "Move to note folder" / "Move to…")
// Kept module-level so the NodeView closures stay light.

// True if the node-attribute src is a local/relative path we can resolve on disk.
const isLocalImageSrc = (src: string): boolean => {
  if (!src) return false;
  const s = src.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return false; // http://, https://, tauri://, file://
  if (s.startsWith('data:')) return false;
  if (s.startsWith('//')) return false; // protocol-relative
  return true;
};

const normalizePath = (p: string): string =>
  (p ?? '').replace(/\\/g, '/').replace(/\/+/g, '/');

const stripTrailingSlash = (p: string): string => p.replace(/\/+$/, '');

// Collapse '.' and '..' segments in a POSIX-style path. Preserves a leading
// '/' (POSIX absolute) or 'C:/' (Windows drive). Without this, joins like
// `noteDir + "/../foo.png"` keep the literal `..` in the string, which makes
// dialog text ugly and breaks any string-equality dir comparisons.
const canonicalizePath = (p: string): string => {
  const norm = normalizePath(p);
  // Detect and strip a leading anchor (POSIX '/' or Windows 'C:/').
  let anchor = '';
  let rest = norm;
  if (/^[a-zA-Z]:\//.test(norm)) {
    anchor = norm.slice(0, 3);
    rest = norm.slice(3);
  } else if (norm.startsWith('/')) {
    anchor = '/';
    rest = norm.slice(1);
  }
  const segs = rest.split('/');
  const out: string[] = [];
  for (const s of segs) {
    if (!s || s === '.') continue;
    if (s === '..') { if (out.length) out.pop(); continue; }
    out.push(s);
  }
  return anchor + out.join('/');
};

// Resolve a possibly-relative image src against the note's directory and
// canonicalize the result so '..'/'.' segments are collapsed.
const resolveImageAbsolutePath = (src: string, noteDir: string): string => {
  const s = normalizePath(src).replace(/^\.\//, '');
  const base = stripTrailingSlash(normalizePath(noteDir));
  if (s.startsWith('/')) return canonicalizePath(s);
  if (/^[a-zA-Z]:\//.test(s)) return canonicalizePath(s); // Windows drive letter
  const decoded = (() => { try { return decodeURIComponent(s); } catch { return s; } })();
  return canonicalizePath((base + '/' + decoded).replace(/\/+/g, '/'));
};

const baseNameOf = (p: string): string => {
  const norm = normalizePath(p);
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
};

const isAlreadyInDir = (imgAbs: string, dir: string): boolean => {
  const imgDir = stripTrailingSlash(splitFilePath(imgAbs).path);
  const nDir = stripTrailingSlash(normalizePath(dir));
  return imgDir === nDir;
};

// Windows drive-letter detection for "different drive" cases where POSIX-style
// relative paths don't make sense.
const getWindowsDrive = (p: string): string | null => {
  const m = /^([a-zA-Z]):\//.exec(normalizePath(p));
  return m ? m[1].toLowerCase() : null;
};

// POSIX-style relative path FROM `fromDir` TO `toPath`. Null if not computable
// (different Windows drive).
const computeRelativePath = (fromDir: string, toPath: string): string | null => {
  const from = stripTrailingSlash(normalizePath(fromDir));
  const to = normalizePath(toPath);

  const fromDrive = getWindowsDrive(from);
  const toDrive = getWindowsDrive(to);
  if (fromDrive && toDrive && fromDrive !== toDrive) return null;

  const fromSegs = from.split('/').filter(Boolean);
  const toSegs = to.split('/').filter(Boolean);

  let i = 0;
  while (i < fromSegs.length && i < toSegs.length && fromSegs[i] === toSegs[i]) i++;

  const upSegs = fromSegs.slice(i).map(() => '..');
  const downSegs = toSegs.slice(i);
  const rel = [...upSegs, ...downSegs].join('/');
  return rel.length > 0 ? rel : '.';
};

const IMAGE_MIME = /^image\//i;

/** One-time window-level drop interceptor. Runs in the capture phase so it
 *  fires BEFORE any ProseMirror plugin or Milkdown's URL-to-link handler gets
 *  a chance to consume the drop. If the drop is an image (files or remote URL)
 *  AND lands inside an editor, we `preventDefault` + `stopImmediatePropagation`
 *  and handle it ourselves. Non-image drops fall through untouched.
 *
 *  Window-level (not editor-level) because Milkdown / ProseMirror plugins with
 *  higher priority (URL-to-link) would otherwise consume browser URL drops
 *  before our handler runs. */
let interceptorAttached = false;
function attachDropInterceptor(): void {
  if (interceptorAttached) return;
  interceptorAttached = true;

  window.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    const target = e.target as HTMLElement | null;
    const inEditor = !!target?.closest('.milkdown, .ProseMirror, [contenteditable="true"]');
    if (!inEditor) return;

    // Prefer local image files. Otherwise look for a remote image URL.
    const hasImageFile = Array.from(dt.files).some((f) => IMAGE_MIME.test(f.type));
    const url = hasImageFile ? null : imageUrlFromDrop(dt);
    if (!hasImageFile && !url) return;

    // We own this drop. Stop everything (ProseMirror / link plugins / default insert).
    e.preventDefault();
    e.stopImmediatePropagation();

    const pmDom = (target?.closest('.ProseMirror') as HTMLElement) ?? null;
    const view = pmViewFromDom(pmDom);
    if (!view) return;

    if (hasImageFile) {
      const files = Array.from(dt.files).filter((f) => IMAGE_MIME.test(f.type));
      void handleImageFiles(view, files);
      return;
    }
    void (async () => {
      const blob = await blobFromRemoteUrl(url!);
      if (!blob) {
        toastError(t('PASTE_IMAGE_ERROR_WRITE_FAILED'));
        return;
      }
      const ext = extFromMime(blob.type) ?? 'png';
      const file = new File([blob], `dropped.${ext}`, { type: blob.type });
      void handleImageFiles(view, [file]);
    })();
  }, { capture: true });
}

/** ProseMirror stashes its EditorView on the DOM element via an internal key
 *  (`pmViewDesc` on child nodes, `editorView` on Milkdown roots). Walk the
 *  candidates we know about; return null if none match. */
function pmViewFromDom(dom: HTMLElement | null): EditorView | null {
  if (!dom) return null;
  // Milkdown patches the editor root with a non-standard `editorView` ref in
  // some versions; fall back to a global lookup if unavailable.
  const any = dom as unknown as { editorView?: EditorView; ['pmViewDesc']?: { node?: unknown; parent?: unknown } };
  if (any.editorView) return any.editorView;
  // ProseMirror doesn't put the view directly on the DOM — but we can find it
  // by climbing to the editor root and asking for `__view` or a stashed one.
  // Simplest reliable method: every PM editor calls `view.dom = this rootEl`,
  // and PM sets `.pmViewDesc` on child nodes but NOT on the root. So we rely
  // on a module-level registry populated by each plugin instance.
  return lastActiveView;
}

/** Module-level "last editor view seen by this plugin", used by the window
 *  drop interceptor as a fallback when the PM root doesn't expose its view. */
let lastActiveView: EditorView | null = null;

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function errorMessage(err: SaveImageErrorCode, size?: number): string {
  switch (err) {
    case 'no-vault':
      return t('PASTE_IMAGE_ERROR_NO_VAULT');
    case 'too-large':
      return t('PASTE_IMAGE_ERROR_TOO_LARGE', {
        limit: formatBytes(MAX_PASTE_IMAGE_BYTES),
        size: size != null ? formatBytes(size) : '?',
      });
    case 'unsupported-type':
      return t('PASTE_IMAGE_ERROR_UNSUPPORTED');
    case 'write-failed':
      return t('PASTE_IMAGE_ERROR_WRITE_FAILED');
  }
}

function imageFilesFromClipboard(items: DataTransferItemList | null | undefined): File[] {
  if (!items) return [];
  const out: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file' && IMAGE_MIME.test(item.type)) {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

function imageFilesFromDrop(files: FileList | null | undefined): File[] {
  if (!files) return [];
  const out: File[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (IMAGE_MIME.test(f.type)) out.push(f);
  }
  return out;
}

/**
 * Extract an image URL from a drag payload that carries only URI/HTML data
 * (typical when dragging an image from a Chrome browser tab — `dataTransfer.files`
 * is empty for remote images). Prefers `text/uri-list` (one URL per line, `#`
 * comments ignored), falls back to the first `<img src>` in `text/html`.
 */
function imageUrlFromDrop(dt: DataTransfer | null | undefined): string | null {
  if (!dt) return null;
  // 1) Prefer `<img src>` from text/html. When dragging from Google Images,
  //    Chrome puts the viewer-page URL in text/uri-list and the *actual* image
  //    URL in an <img src> inside text/html. Same for many CMS/news sites.
  const html = dt.getData('text/html');
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const src = doc.querySelector('img')?.getAttribute('src') ?? '';
    if (/^https?:\/\//i.test(src)) return src;
  }
  // 2) Fall back to uri-list / moz-url. If the first URL is a Google-Images
  //    `imgres` redirect page, pull the `imgurl` param instead.
  const uriList = dt.getData('text/uri-list') || dt.getData('text/x-moz-url') || '';
  for (const line of uriList.split(/\r?\n/)) {
    const url = line.trim();
    if (!url || url.startsWith('#')) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      const u = new URL(url);
      if (u.hostname.endsWith('google.com') && u.pathname === '/imgres') {
        const imgurl = u.searchParams.get('imgurl');
        if (imgurl && /^https?:\/\//i.test(imgurl)) return imgurl;
      }
    } catch { /* bad URL, skip */ }
    return url;
  }
  const plain = dt.getData('text/plain').trim();
  if (/^https?:\/\/\S+$/i.test(plain)) return plain;
  return null;
}

/** Derive a filename extension from a MIME type we'll keep, or null if unknown. */
function extFromMime(mime: string): string | null {
  switch (mime.toLowerCase()) {
    case 'image/png': return 'png';
    case 'image/jpeg':
    case 'image/jpg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    case 'image/svg+xml': return 'svg';
    case 'image/bmp': return 'bmp';
    default: return null;
  }
}

/**
 * Fetch a remote image URL through the Rust backend (bypasses webview CORS)
 * and return a Blob suitable for `handleImageFiles`. Returns null on any
 * failure so the caller can surface a toast.
 */
async function blobFromRemoteUrl(url: string): Promise<Blob | null> {
  try {
    const res = await invoke<{ bytes: number[]; mime: string }>('fetch_image_bytes', { url });
    if (!res) return null;
    const mime = (res.mime || '').toLowerCase();
    if (!extFromMime(mime)) return null;
    return new Blob([new Uint8Array(res.bytes)], { type: mime });
  } catch {
    return null;
  }
}

// Resize constraints — match the plan §13.x "pixels, width-only with aspect lock".
const MIN_IMAGE_WIDTH = 80;
const MAX_IMAGE_WIDTH_FRACTION = 1.0; // of editor content width

/**
 * Node view: renders <img> with the resolved asset:// URL and a draggable corner
 * handle for resizing. The handle updates `attrs.width` (pixels). Serialization
 * reads attrs.src / attrs.width, so the stored markdown stays portable:
 *   - no width → `![alt](src)` (clean markdown)
 *   - width set → `<img src alt width />` (portable HTML, valid CommonMark)
 * See docs/plans/2026-04-21-editor-paste-image-to-file.md (Path C).
 */
function createImageNodeView(): NodeViewConstructor {
  return (node, view, getPos) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'binderus-image';
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';
    wrapper.style.maxWidth = '100%';
    // Reserve room on the right for the hover toolbar so the toolbar lives
    // inside the wrapper's hit-test box. Without this, the mouse crosses out
    // of the image rect before reaching the toolbar, triggering mouseleave
    // and hiding it prematurely.
    wrapper.style.paddingRight = '40px';
    // Default (arrow) cursor so the image feels clickable, not like editable text.
    wrapper.style.cursor = 'default';
    // Don't participate in text selection — clicking the image shouldn't
    // drag-select surrounding text or paint a selection highlight over the
    // image. Caption opts back in so users can copy the description text.
    wrapper.style.userSelect = 'none';
    (wrapper.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none';

    const img = document.createElement('img');
    img.style.display = 'block';
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.cursor = 'default';
    wrapper.appendChild(img);

    // Caption under the image — shows the image's alt text as a muted, italic
    // subtitle. Hidden when alt is empty so undescribed images don't get an
    // empty line. `contenteditable=false` keeps ProseMirror's text cursor out
    // of it; the real text is the node's `alt` attr, not this DOM node.
    const caption = document.createElement('span');
    caption.className = 'binderus-image__caption';
    caption.setAttribute('contenteditable', 'false');
    Object.assign(caption.style, {
      display: 'block',
      marginTop: '4px',
      fontSize: '13px',
      lineHeight: '1.4',
      fontStyle: 'italic',
      opacity: '0.7',
      textAlign: 'center',
      userSelect: 'text',
    } satisfies Partial<CSSStyleDeclaration>);
    wrapper.appendChild(caption);

    // --- Floating toolbar (shown when image is selected) -----------------
    const toolbar = document.createElement('span');
    toolbar.className = 'binderus-image__toolbar';
    toolbar.setAttribute('contenteditable', 'false');
    Object.assign(toolbar.style, {
      position: 'absolute',
      top: '0',
      right: '4px',
      flexDirection: 'column',
      gap: '2px',
      display: 'none',
      padding: '2px',
      borderRadius: '4px',
      background: 'rgba(0, 0, 0, 0.7)',
      zIndex: '2',
    } satisfies Partial<CSSStyleDeclaration>);

    const iconBtnStyle: Partial<CSSStyleDeclaration> = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '24px',
      height: '24px',
      padding: '0',
      border: 'none',
      background: 'transparent',
      color: '#fff',
      cursor: 'pointer',
    };

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'binderus-image__preview-btn';
    previewBtn.title = t('PASTE_IMAGE_PREVIEW_TITLE');
    previewBtn.setAttribute('aria-label', t('PASTE_IMAGE_PREVIEW_TITLE'));
    Object.assign(previewBtn.style, iconBtnStyle);
    // Inline SVG eye icon — clearer "view this image" semantics than a
    // magnifying glass (which connotes search/zoom-within) or expand arrows
    // (which connote fullscreen layout). Matches Figma / Google Drive / Notion
    // attachment-preview conventions.
    previewBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/>' +
      '<circle cx="12" cy="12" r="3"/></svg>';
    toolbar.appendChild(previewBtn);

    // Single "Move…" button — opens a small popup with two choices to keep the
    // toolbar uncluttered. Folder-with-arrow icon doubles for both actions.
    // In FS mode this performs a real file move via `move_files`; in DB mode
    // the image bytes are deduped in the blob store and stay there — the
    // backend just creates a sidebar-visible files-row at the destination.
    const moveBtn = document.createElement('button');
    moveBtn.type = 'button';
    moveBtn.className = 'binderus-image__move-btn';
    moveBtn.title = t('IMAGE_TOOLBAR_MOVE_TITLE');
    moveBtn.setAttribute('aria-label', t('IMAGE_TOOLBAR_MOVE_TITLE'));
    Object.assign(moveBtn.style, iconBtnStyle);
    moveBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
      '<path d="M12 11v5"/><path d="M9 14l3 3 3-3"/></svg>';
    toolbar.appendChild(moveBtn);

    // Inline popup with the two move targets — built once, shown on demand.
    const movePopup = document.createElement('div');
    movePopup.className = 'binderus-image__move-popup';
    movePopup.setAttribute('contenteditable', 'false');
    Object.assign(movePopup.style, {
      position: 'absolute',
      // Sit just to the LEFT of the toolbar (toolbar is anchored at right: 4px,
      // 28px wide), so the popup grows into the image area instead of off-screen.
      top: '0',
      right: '38px',
      display: 'none',
      flexDirection: 'column',
      minWidth: '180px',
      padding: '4px',
      borderRadius: '6px',
      background: 'rgba(0, 0, 0, 0.85)',
      color: '#fff',
      fontSize: '12px',
      zIndex: '3',
      boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
    } satisfies Partial<CSSStyleDeclaration>);

    const popupItemStyle: Partial<CSSStyleDeclaration> = {
      display: 'block',
      width: '100%',
      textAlign: 'left',
      padding: '6px 10px',
      border: 'none',
      background: 'transparent',
      color: '#fff',
      cursor: 'pointer',
      borderRadius: '4px',
      fontSize: '12px',
    };

    const moveHereBtn = document.createElement('button');
    moveHereBtn.type = 'button';
    Object.assign(moveHereBtn.style, popupItemStyle);
    moveHereBtn.textContent = t('IMAGE_TOOLBAR_MOVE_TO_NOTE_LABEL');
    moveHereBtn.addEventListener('mouseenter', () => { moveHereBtn.style.background = 'rgba(255,255,255,0.12)'; });
    moveHereBtn.addEventListener('mouseleave', () => { moveHereBtn.style.background = 'transparent'; });

    const moveElsewhereBtn = document.createElement('button');
    moveElsewhereBtn.type = 'button';
    Object.assign(moveElsewhereBtn.style, popupItemStyle);
    moveElsewhereBtn.textContent = t('IMAGE_TOOLBAR_MOVE_TO_LABEL');
    moveElsewhereBtn.addEventListener('mouseenter', () => { moveElsewhereBtn.style.background = 'rgba(255,255,255,0.12)'; });
    moveElsewhereBtn.addEventListener('mouseleave', () => { moveElsewhereBtn.style.background = 'transparent'; });

    movePopup.append(moveHereBtn, moveElsewhereBtn);
    wrapper.appendChild(movePopup);

    const hideMovePopup = () => { movePopup.style.display = 'none'; };
    const onDocClickForPopup = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (movePopup.contains(tgt) || moveBtn.contains(tgt)) return;
      hideMovePopup();
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'binderus-image__delete-btn';
    deleteBtn.title = t('PASTE_IMAGE_DELETE_TITLE');
    deleteBtn.setAttribute('aria-label', t('PASTE_IMAGE_DELETE_TITLE'));
    Object.assign(deleteBtn.style, iconBtnStyle);
    // Inline SVG trash icon — no new asset dependency.
    deleteBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>' +
      '<path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';
    toolbar.appendChild(deleteBtn);

    const handle = document.createElement('span');
    handle.className = 'binderus-image__resize-handle';
    handle.setAttribute('contenteditable', 'false');
    // Minimal inline style so the plugin works even if the app CSS hasn't styled .binderus-image yet.
    // App-level stylesheet is free to restyle via the class selector.
    Object.assign(handle.style, {
      position: 'absolute',
      // Sit at the image's bottom-right, 2px inset — the image ends at
      // `wrapper.right - 40px` because the wrapper reserves 40px of padding
      // for the hover toolbar (see wrapper styles above).
      right: '38px',
      bottom: '-2px',
      width: '12px',
      height: '12px',
      background: 'rgba(0, 0, 0, 0.6)',
      border: '2px solid #fff',
      borderRadius: '2px',
      cursor: 'nwse-resize',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    wrapper.appendChild(handle);
    wrapper.appendChild(toolbar);

    // Show both resize handle and toolbar on hover. Toolbar also stays visible
    // while the image is the active selection (see selectNode/deselectNode below);
    // hover-only is the common case since clicks on the image frequently land
    // on the resize handle / toolbar buttons themselves.
    let isSelected = false;
    const showOverlayIfEditable = () => {
      if (!view.editable) return;
      handle.style.display = 'block';
      toolbar.style.display = 'inline-flex';
    };
    const hideOverlay = () => {
      handle.style.display = 'none';
      if (!isSelected) {
        toolbar.style.display = 'none';
        hideMovePopup();
      }
    };
    wrapper.addEventListener('mouseenter', showOverlayIfEditable);
    wrapper.addEventListener('mouseleave', hideOverlay);

    // Preview handler — opens the full-window preview overlay with an inline
    // description editor. Saves write to both the metadata store and the
    // image node's `alt` attribute so the markdown stays portable.
    const onPreviewClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof getPos !== 'function') return;
      const pos = getPos();
      if (pos == null) return;
      const current = view.state.doc.nodeAt(pos);
      if (!current || current.type.name !== 'image') return;
      const src = (current.attrs.src as string) ?? '';
      if (!src) return;
      const initialAlt = (current.attrs.alt as string) ?? '';
      const filePath = absFilePathFromRel(src) ?? undefined;
      showImagePreview({
        src: resolveImageSrc(src),
        filePath,
        initialAlt,
        onAltChange: (newAlt) => {
          // Re-resolve the position in case the doc shifted while the overlay was open.
          const p = getPos();
          if (p == null) return;
          const stillThere = view.state.doc.nodeAt(p);
          if (!stillThere || stillThere.type.name !== 'image') return;
          if ((stillThere.attrs.alt ?? '') === newAlt) return;
          view.dispatch(view.state.tr.setNodeAttribute(p, 'alt', newAlt));
        },
      });
    };
    previewBtn.addEventListener('click', onPreviewClick);
    // Clicking the image itself opens the preview overlay — matches the
    // Preview button behavior so users don't have to hunt for the toolbar.
    img.addEventListener('click', onPreviewClick);
    img.style.cursor = 'zoom-in';

    // Delete handler: prompt with honest warning (we have no cross-note ref index yet —
    // see plan §12 open-q 11), then delete the file/blob and remove the image node.
    const onDeleteClick = async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!view.editable) return;
      if (typeof getPos !== 'function') return;
      const pos = getPos();
      if (pos == null) return;
      const current = view.state.doc.nodeAt(pos);
      if (!current || current.type.name !== 'image') return;
      const relPath = (current.attrs.src as string) ?? '';
      if (!relPath) return;

      const confirmed = await showConfirm({
        title: t('PASTE_IMAGE_DELETE_TITLE'),
        message: t('PASTE_IMAGE_DELETE_CONFIRM'),
        danger: true,
      });
      if (!confirmed) return;

      const ok = await deleteImageFromVault(relPath);
      if (!ok) {
        toastError(t('PASTE_IMAGE_ERROR_DELETE_FAILED'));
        return;
      }
      // Remove the image node from the doc. Re-resolve position in case the
      // document shifted while the confirm dialog was open.
      const pos2 = getPos();
      if (pos2 == null) return;
      const stillThere = view.state.doc.nodeAt(pos2);
      if (!stillThere || stillThere.type.name !== 'image') return;
      view.dispatch(view.state.tr.delete(pos2, pos2 + stillThere.nodeSize));
    };
    deleteBtn.addEventListener('click', onDeleteClick);

    // --- Move-image actions ---------------------------------------------
    // Pre-flight: validates state and returns the resolved absolute image path
    // plus the active note's directory. Returns null after surfacing a
    // user-visible explanation when something blocks the move.
    const movePreflight = async (): Promise<
      { node: any; pos: number; imgAbs: string; noteDir: string } | null
    > => {
      if (typeof getPos !== 'function') return null;
      const pos = getPos();
      if (pos == null) return null;
      const current = view.state.doc.nodeAt(pos);
      if (!current || current.type.name !== 'image') return null;

      const rawSrc: string = (current.attrs?.src ?? '') as string;
      if (!isLocalImageSrc(rawSrc)) {
        await showAlert({
          title: t('IMAGE_TOOLBAR_DIALOG_TITLE'),
          message: t('IMAGE_TOOLBAR_NON_LOCAL_SRC', { src: rawSrc || t('IMAGE_TOOLBAR_EMPTY_SRC') }),
        });
        return null;
      }

      const activePath = useAppStore.getState().activeTabPath;
      if (!activePath) {
        await showAlert({ title: t('IMAGE_TOOLBAR_DIALOG_TITLE'), message: t('IMAGE_TOOLBAR_NO_ACTIVE_NOTE') });
        return null;
      }

      const { path: noteDir } = splitFilePath(activePath);
      if (!noteDir) {
        await showAlert({ title: t('IMAGE_TOOLBAR_DIALOG_TITLE'), message: t('IMAGE_TOOLBAR_NO_NOTE_DIR') });
        return null;
      }

      return { node: current, pos, imgAbs: resolveImageAbsolutePath(rawSrc, noteDir), noteDir };
    };

    // Confirms with the user, runs the move on disk, then rewrites the image
    // node's src to a path relative to the note (falling back to absolute when
    // a relative path can't be expressed — different Windows drive).
    const performMove = async (
      pf: { node: any; pos: number; imgAbs: string; noteDir: string },
      destDir: string,
    ) => {
      const { imgAbs, noteDir, pos } = pf;
      const destNorm = stripTrailingSlash(normalizePath(destDir));

      if (isAlreadyInDir(imgAbs, destNorm)) {
        await showAlert({
          title: t('IMAGE_TOOLBAR_DIALOG_TITLE'),
          message: t('IMAGE_TOOLBAR_ALREADY_IN_FOLDER', { dir: destNorm }),
        });
        return;
      }

      const newAbs = destNorm + '/' + baseNameOf(imgAbs);
      const rel = computeRelativePath(noteDir, newAbs);
      const newSrc = rel ?? newAbs;

      const confirmed = await showConfirm({
        title: t('IMAGE_TOOLBAR_CONFIRM_TITLE'),
        message: t('IMAGE_TOOLBAR_CONFIRM_MOVE_BODY', { from: imgAbs, to: newAbs, newSrc }),
        danger: false,
      });
      if (!confirmed) { view.focus(); return; }

      try {
        if (isDbMode()) {
          // DB mode: bytes live in the blob store keyed by 12-char sha256
          // (see saveImageToVault). The blob is shared/deduped across notes,
          // so we never delete it on a per-note Move. Instead we ask the
          // backend to create a `files` row at the destination — that makes
          // the image appear in the sidebar tree under the chosen folder
          // while the bytes still resolve via hash through `bin-img://`.
          const rawSrc = (pf.node.attrs?.src as string) ?? '';
          const hash = hashFromRelPath(rawSrc.replace(/^\/+/, ''));
          if (!hash) {
            await showAlert({
              title: t('IMAGE_TOOLBAR_DIALOG_TITLE'),
              message: t('IMAGE_TOOLBAR_NON_LOCAL_SRC', { src: rawSrc || t('IMAGE_TOOLBAR_EMPTY_SRC') }),
            });
            return;
          }
          await invoke('promote_image_to_file_entry', { hash, destAbsPath: newAbs });
        } else {
          await moveFiles([imgAbs], destNorm);
        }
      } catch (err) {
        toastError(t('IMAGE_TOOLBAR_MOVE_FAILED', { error: String(err) }));
        return;
      }

      // Ping the sidebar to refresh — the underlying op invalidates relevant
      // dir caches, but the sidebar tree's React state still shows the old
      // listing until we tell it to reload.
      useAppStore.getState().setRefreshFolder(true);

      // Re-resolve in case the doc shifted while the dialog was open.
      const p = getPos?.();
      if (p == null) return;
      const fresh = view.state.doc.nodeAt(p);
      if (!fresh || fresh.type.name !== 'image') return;
      view.dispatch(view.state.tr.setNodeMarkup(p, undefined, { ...fresh.attrs, src: newSrc }));
      view.focus();
    };

    const onMoveBtnClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!view.editable) return;
      // Toggle the popup; defer the document listener so this same click
      // doesn't immediately close it.
      const open = movePopup.style.display !== 'flex';
      movePopup.style.display = open ? 'flex' : 'none';
      if (open) setTimeout(() => document.addEventListener('click', onDocClickForPopup, true), 0);
      else document.removeEventListener('click', onDocClickForPopup, true);
    };

    const onMoveHereClick = async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      hideMovePopup();
      document.removeEventListener('click', onDocClickForPopup, true);
      const pf = await movePreflight();
      if (!pf) return;
      await performMove(pf, pf.noteDir);
    };

    const onMoveElsewhereClick = async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      hideMovePopup();
      document.removeEventListener('click', onDocClickForPopup, true);
      const pf = await movePreflight();
      if (!pf) return;
      // Reuse the in-app FolderTreeModal (vault-rooted) so users pick a folder
      // inside the vault — matches the sidebar "Move…" UX and avoids the
      // native folder dialog.
      const picked = await showFolderPicker({ confirmLabel: t('IMAGE_TOOLBAR_PICK_FOLDER_TITLE') });
      if (!picked) { view.focus(); return; }
      await performMove(pf, picked);
    };

    moveBtn.addEventListener('click', onMoveBtnClick);
    moveHereBtn.addEventListener('click', onMoveHereClick);
    moveElsewhereBtn.addEventListener('click', onMoveElsewhereClick);

    const apply = (n: typeof node) => {
      const raw = (n.attrs.src as string) ?? '';
      img.setAttribute('data-src', raw);
      img.src = resolveImageSrc(raw);
      const altText = (n.attrs.alt as string) ?? '';
      img.alt = altText;
      if (n.attrs.title) img.title = n.attrs.title as string;
      else img.removeAttribute('title');
      // Sync caption with alt. Empty alt → caption is hidden rather than
      // shown as an empty line.
      caption.textContent = altText;
      caption.style.display = altText ? 'block' : 'none';

      const width = n.attrs.width as number | null;
      if (typeof width === 'number' && width > 0) {
        img.style.width = `${width}px`;
        img.removeAttribute('height');
      } else {
        img.style.width = '';
      }
    };

    apply(node);

    // Drag-to-resize: width only, aspect ratio locked by `height: auto`.
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    let liveWidth = 0;

    const containerMaxWidth = () => {
      const editorEl = view.dom as HTMLElement;
      const cs = getComputedStyle(editorEl);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const usable = editorEl.clientWidth - padL - padR;
      return Math.max(MIN_IMAGE_WIDTH, Math.floor(usable * MAX_IMAGE_WIDTH_FRACTION));
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!view.editable) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      startX = e.clientX;
      startWidth = img.getBoundingClientRect().width;
      liveWidth = Math.round(startWidth);
      handle.setPointerCapture(e.pointerId);
      wrapper.classList.add('is-resizing');
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const max = containerMaxWidth();
      liveWidth = Math.max(MIN_IMAGE_WIDTH, Math.min(max, Math.round(startWidth + dx)));
      img.style.width = `${liveWidth}px`;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* pointer may have already been released */ }
      wrapper.classList.remove('is-resizing');
      // Commit width to the node attrs so it becomes part of the doc state and serializes to markdown.
      if (typeof getPos !== 'function') return;
      const pos = getPos();
      if (pos == null) return;
      const current = view.state.doc.nodeAt(pos);
      if (!current || current.type.name !== 'image') return;
      if ((current.attrs.width ?? null) === liveWidth) return;
      view.dispatch(view.state.tr.setNodeAttribute(pos, 'width', liveWidth));
    };

    // Double-click handle = reset to natural size (clears width → clean markdown).
    const onDoubleClick = (e: MouseEvent) => {
      if (!view.editable) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof getPos !== 'function') return;
      const pos = getPos();
      if (pos == null) return;
      view.dispatch(view.state.tr.setNodeAttribute(pos, 'width', null));
    };

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
    handle.addEventListener('dblclick', onDoubleClick);

    return {
      dom: wrapper,
      update(newNode) {
        if (newNode.type.name !== 'image') return false;
        apply(newNode);
        return true;
      },
      selectNode() {
        isSelected = true;
        wrapper.classList.add('is-selected');
        if (view.editable) toolbar.style.display = 'inline-flex';
      },
      deselectNode() {
        isSelected = false;
        wrapper.classList.remove('is-selected');
        toolbar.style.display = 'none';
        hideMovePopup();
      },
      stopEvent(event) {
        // Keep pointer events on the resize handle and toolbar out of ProseMirror's hands
        // so dragging the handle or clicking delete doesn't move the selection.
        const target = event.target as HTMLElement | null;
        if (!target) return false;
        return !!(
          target.closest('.binderus-image__resize-handle') ||
          target.closest('.binderus-image__toolbar')
        );
      },
      ignoreMutation() {
        // Our DOM changes (style.width during drag, toolbar show/hide) are local cosmetic
        // updates; PM needn't re-read.
        return true;
      },
      destroy() {
        wrapper.removeEventListener('mouseenter', showOverlayIfEditable);
        wrapper.removeEventListener('mouseleave', hideOverlay);
        handle.removeEventListener('pointerdown', onPointerDown);
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', onPointerUp);
        handle.removeEventListener('pointercancel', onPointerUp);
        handle.removeEventListener('dblclick', onDoubleClick);
        previewBtn.removeEventListener('click', onPreviewClick);
        img.removeEventListener('click', onPreviewClick);
        deleteBtn.removeEventListener('click', onDeleteClick);
        moveBtn.removeEventListener('click', onMoveBtnClick);
        moveHereBtn.removeEventListener('click', onMoveHereClick);
        moveElsewhereBtn.removeEventListener('click', onMoveElsewhereClick);
        document.removeEventListener('click', onDocClickForPopup, true);
      },
    };
  };
}

async function handleImageFiles(view: EditorView, files: File[]): Promise<void> {
  const imageType = view.state.schema.nodes['image'];
  if (!imageType) {
    toastError(t('PASTE_IMAGE_ERROR_WRITE_FAILED'));
    return;
  }

  for (const file of files) {
    const result = await saveImageToVault(file);
    if (!result.ok) {
      toastError(errorMessage(result.error, file.size));
      continue;
    }
    // Dedup optimization: if this image hash was previously described in
    // another note, pre-fill the new image node's `alt` with the stored
    // description so the same image has a consistent screen-reader narrative
    // across the vault. Best-effort — failures just fall through to empty alt.
    let alt = '';
    const absFile = absFilePathFromRel(result.relPath);
    if (absFile) {
      try {
        const meta = await invoke<{ description?: string | null } | null>(
          'get_file_metadata',
          { filePath: absFile },
        );
        if (meta?.description) alt = meta.description;
      } catch {
        /* ignore */
      }
    }
    const node = imageType.create({ src: result.relPath, alt, title: null });
    const tr = view.state.tr.replaceSelectionWith(node);
    view.dispatch(tr.scrollIntoView());
  }
}

export const pasteImagePlugin = $prose(() => {
  attachDropInterceptor();
  return new Plugin({
    view(view) {
      // Stash the latest EditorView so the window-level drop interceptor can
      // dispatch to it. Multi-editor (tabs) just overwrites — the interceptor
      // only matters for whichever editor is actually being dropped into, and
      // we locate that via `target.closest('.ProseMirror')` + this ref.
      lastActiveView = view;
      return {
        destroy() {
          if (lastActiveView === view) lastActiveView = null;
        },
      };
    },
    key: new PluginKey('binderus-paste-image'),
    props: {
      nodeViews: {
        image: createImageNodeView(),
      },
      handlePaste(view, event) {
        const files = imageFilesFromClipboard(event.clipboardData?.items);
        if (files.length === 0) return false;
        // Hard rule (plan §7.2): once an image file is detected, we own this event.
        // preventDefault BEFORE any async work so no other handler can base64-inline.
        event.preventDefault();
        void handleImageFiles(view, files);
        return true;
      },
      handleDrop(view, event) {
        const dt = event.dataTransfer;
        const files = imageFilesFromDrop(dt?.files);
        if (files.length > 0) {
          event.preventDefault();
          void handleImageFiles(view, files);
          return true;
        }
        // No local files? Check for a remote image URL (Chrome browser drag etc.).
        // Fetch the bytes via the Rust-side `fetch_image_bytes` command, then
        // funnel through the normal paste pipeline so dedup/size/MIME rules apply.
        const url = imageUrlFromDrop(dt);
        if (!url) return false;
        event.preventDefault();
        void (async () => {
          const blob = await blobFromRemoteUrl(url);
          if (!blob) {
            toastError(t('PASTE_IMAGE_ERROR_WRITE_FAILED'));
            return;
          }
          const ext = extFromMime(blob.type) ?? 'png';
          const file = new File([blob], `dropped.${ext}`, { type: blob.type });
          void handleImageFiles(view, [file]);
        })();
        return true;
      },
    },
  });
});
