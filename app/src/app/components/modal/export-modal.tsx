/**
 * Description: Export modal for exporting the current note to PDF, DOCX, or HTML format.
 * Requirements: Active editor tab with markdown content.
 * Inputs: isOpen, onClose, markdown content from active tab, file name.
 * Outputs: PDF via browser print, DOCX file saved to disk, or HTML file saved to disk.
 */
import { Dialog, DialogPanel, DialogTitle, Transition } from '@headlessui/react';
import { Fragment, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { isWeb } from '../../utils/base-utils';
import { getDocumentDir } from '../../utils/tauri-utils';
import { revealItemInDir, openPath } from '@tauri-apps/plugin-opener';
import { toastError, toastSuccess } from '../toaster/toaster';
import { BsFileCode, BsFileWord, BsPrinter } from 'react-icons/bs';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  markdown: string;
  fileName: string;
}

type ExportFormat = 'print' | 'docx' | 'html';

// ── Markdown → HTML converter ──────────────────────────────────────────────

/** Escape HTML special characters. */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Convert markdown to HTML for export. Handles headings, bold/italic, code
 *  fences, inline code, tables, ordered/unordered lists, blockquotes, links,
 *  images, and horizontal rules. */
function markdownToHtml(md: string): string {
  // Extract fenced code blocks first to protect their content
  const codeBlocks: string[] = [];
  let processed = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    codeBlocks.push(`<pre><code${langAttr}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
    return `\n%%CODEBLOCK_${idx}%%\n`;
  });

  // Split into lines for block-level processing
  const lines = processed.split('\n');
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block placeholder
    const cbMatch = line.match(/^%%CODEBLOCK_(\d+)%%$/);
    if (cbMatch) {
      output.push(codeBlocks[parseInt(cbMatch[1], 10)]);
      i++;
      continue;
    }

    // Table: line starts with | and next line is a separator row
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      output.push(parseTable(tableLines));
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      output.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      output.push('<hr>');
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const bqLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        bqLines.push(lines[i].slice(2));
        i++;
      }
      output.push(`<blockquote><p>${bqLines.map(inlineFormat).join('<br>')}</p></blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ''));
        i++;
      }
      output.push('<ul>' + items.map((t) => `<li>${inlineFormat(t)}</li>`).join('') + '</ul>');
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      output.push('<ol>' + items.map((t) => `<li>${inlineFormat(t)}</li>`).join('') + '</ol>');
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: collect consecutive non-blank, non-special lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|%%CODEBLOCK|\|)/.test(lines[i]) && !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      output.push(`<p>${paraLines.map(inlineFormat).join('<br>')}</p>`);
    }
  }

  return output.join('\n');
}

/** Apply inline formatting: bold, italic, strikethrough, inline code, links, images. */
function inlineFormat(text: string): string {
  return text
    // Images: ![alt](src)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">')
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Bold+italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    // Inline code (must come after bold/italic to avoid conflicts)
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** Parse a markdown table (array of `|`-delimited lines) into an HTML table. */
function parseTable(lines: string[]): string {
  const parseCells = (row: string) =>
    row.split('|').slice(1, -1).map((c) => c.trim());

  const headers = parseCells(lines[0]);
  // lines[1] is the separator row — skip it
  const bodyRows = lines.slice(2).map(parseCells);

  let html = '<table><thead><tr>';
  html += headers.map((h) => `<th>${inlineFormat(h)}</th>`).join('');
  html += '</tr></thead><tbody>';
  for (const row of bodyRows) {
    html += '<tr>' + row.map((c) => `<td>${inlineFormat(c)}</td>`).join('') + '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

// ── Shared styles ──────────────────────────────────────────────────────────

const BASE_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #333; }
  h1, h2, h3, h4, h5, h6 { margin-top: 1.2em; margin-bottom: 0.5em; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; font-family: Consolas, 'Courier New', monospace; }
  pre { background: #f4f4f4; padding: 12px 16px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; border-radius: 0; }
  blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #666; }
  hr { border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }
  ul, ol { padding-left: 1.5em; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f4f4f4; font-weight: 600; }
  img { max-width: 100%; height: auto; }
  a { color: #0969da; text-decoration: none; }
  del { text-decoration: line-through; opacity: 0.7; }
`;

function buildFullHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${BASE_CSS}</style></head><body>${bodyHtml}</body></html>`;
}

// ── Export functions ────────────────────────────────────────────────────────

const PRINT_CSS = `
  @page { margin: 2cm; }
  @media print {
    body { margin: 0; color: #000; }
    pre, code, blockquote, img, table, tr { break-inside: avoid; }
    h1, h2, h3, h4, h5, h6 { break-after: avoid; }
    a { color: #000; text-decoration: underline; }
  }
`;

async function printNote(markdown: string, fileName: string) {
  // Tauri WebView doesn't support window.print().
  // Save styled HTML to a temp file and open in the system browser for printing.
  const html = markdownToHtml(markdown);
  const fullHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(fileName)}</title>
<style>${BASE_CSS}${PRINT_CSS}</style>
<script>window.onload = function() { window.print(); }<\/script>
</head><body>${html}</body></html>`;

  if (isWeb) {
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    return;
  }

  const basePath = await getDocumentDir();
  const baseName = fileName.replace(/\.md$/, '');
  const tmpPath = `${basePath}/${baseName}_print.html`;
  await writeTextFile(tmpPath, fullHtml);
  await openPath(tmpPath);
  toastSuccess('Opened in browser — print dialog will appear automatically');
}

async function exportDocx(markdown: string, fileName: string) {
  // Word/LibreOffice can open HTML with Office XML namespace as .doc natively.
  // This avoids html-to-docx ESM/CJS incompatibility with Vite.
  const html = markdownToHtml(markdown);
  const docHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:w="urn:schemas-microsoft-com:office:word"
    xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: Calibri, Arial, sans-serif; line-height: 1.6; color: #333; }
  h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 13pt; }
  code { font-family: Consolas, 'Courier New', monospace; background: #f4f4f4; padding: 1px 4px; }
  pre { background: #f4f4f4; padding: 8px 12px; white-space: pre-wrap; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #666; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #999; padding: 6px 10px; }
  th { background: #e8e8e8; font-weight: bold; }
  img { max-width: 100%; }
  a { color: #0969da; }
</style></head><body>${html}</body></html>`;

  const blob = new Blob([docHtml], { type: 'application/msword' });
  await saveBlobToFile(blob, fileName, '.doc', 'Word Document', 'Export as DOC');
}

async function exportHtml(markdown: string, fileName: string) {
  const html = markdownToHtml(markdown);
  const fullHtml = buildFullHtml(fileName.replace(/\.md$/, ''), html);

  if (isWeb) {
    const blob = new Blob([fullHtml], { type: 'text/html' });
    downloadBlob(blob, fileName.replace(/\.md$/, '.html'));
    return;
  }

  const baseName = fileName.replace(/\.md$/, '');
  const basePath = await getDocumentDir();
  const savePath = await save({
    title: 'Export as HTML',
    defaultPath: `${basePath}/${baseName}.html`,
    filters: [{ name: 'HTML File', extensions: ['html'] }],
  });
  if (!savePath) return;

  await writeTextFile(savePath, fullHtml);
  toastSuccess(`Exported to ${savePath}`, () => revealItemInDir(savePath));
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Save a Blob via Tauri save dialog, or browser download on web. */
async function saveBlobToFile(blob: Blob, fileName: string, ext: string, filterName: string, title: string) {
  if (isWeb) {
    downloadBlob(blob, fileName.replace(/\.md$/, ext));
    return;
  }

  const baseName = fileName.replace(/\.md$/, '');
  const basePath = await getDocumentDir();
  const savePath = await save({
    title,
    defaultPath: `${basePath}/${baseName}${ext}`,
    filters: [{ name: filterName, extensions: [ext.replace('.', '')] }],
  });
  if (!savePath) return;

  const arrayBuf = await blob.arrayBuffer();
  await writeFile(savePath, new Uint8Array(arrayBuf));
  toastSuccess(`Exported to ${savePath}`, () => revealItemInDir(savePath));
}

/** Web fallback: trigger a browser download for a Blob. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ──────────────────────────────────────────────────────────────

const EXPORT_OPTIONS: { format: ExportFormat; icon: typeof BsFileWord; iconClass: string; label: string; description: string }[] = [
  { format: 'print', icon: BsPrinter, iconClass: 'text-gray-400', label: 'Print', description: 'Open system print dialog (also save as PDF)' },
  { format: 'docx', icon: BsFileWord, iconClass: 'text-blue-400', label: 'Export as DOC', description: 'Save as Word-compatible document' },
  { format: 'html', icon: BsFileCode, iconClass: 'text-green-400', label: 'Export as HTML', description: 'Save as a single HTML file' },
];

export default function ExportModal({ isOpen, onClose, markdown, fileName }: Props) {
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const handleExport = (format: ExportFormat) => {
    // Capture values before unmount, close modal so it doesn't appear in print
    const md = markdown;
    const fn = fileName;
    onClose();
    // Defer export until after modal transition finishes and component unmounts
    setTimeout(async () => {
      try {
        if (format === 'print') await printNote(md, fn);
        else if (format === 'docx') await exportDocx(md, fn);
        else if (format === 'html') await exportHtml(md, fn);
      } catch (err: any) {
        console.error('Export failed:', err);
        toastError(`Export failed: ${err?.message || err}`);
      }
    }, 350);
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="fixed inset-0 z-10 overflow-y-auto" onClose={onClose}>
        <div className="min-h-screen px-4 text-center">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 z-0 bg-black/30" />
          </Transition.Child>

          <span className="inline-block h-screen align-middle" aria-hidden="true">&#8203;</span>

          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <DialogPanel className="dialog-panel relative z-10 inline-block w-full max-w-sm p-6 my-8 text-left align-middle transition-all transform shadow-xl rounded-2xl">
              <DialogTitle as="h3" className="dialog-title text-lg font-medium leading-6">
                Export and Print
              </DialogTitle>

              <div className="dialog-body mt-4 flex flex-col gap-3">
                {EXPORT_OPTIONS.map(({ format, icon: Icon, iconClass, label, description }) => (
                  <button
                    key={format}
                    className="dialog-export-btn flex items-center gap-3 p-3 rounded-lg text-left"
                    onClick={() => handleExport(format)}
                    disabled={exporting !== null}
                  >
                    <Icon size={24} className={`${iconClass} flex-shrink-0`} />
                    <div>
                      <div className="font-medium">{label}</div>
                      <div className="text-xs opacity-60">{description}</div>
                    </div>
                  </button>
                ))}

                {exporting && (
                  <div className="text-sm text-center opacity-60 mt-1">
                    Exporting {exporting.toUpperCase()}...
                  </div>
                )}
              </div>

              <div className="mt-5">
                <button type="button" className="dialog-btn" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </DialogPanel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
