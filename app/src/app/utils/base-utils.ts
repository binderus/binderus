import { FileType } from '../types';
import { DEFAULT_LANG, FAVORITE_LIST_MAX, RECENT_LIST_MAX, VAULT_META_DIR, USER_GUIDE_BASE_URL } from './constants';
import { open } from '@tauri-apps/plugin-shell';

import intl from 'react-intl-universal';
import enUS from '../../locales/en-US.json';
import { getPath } from './tauri-utils';

// Only en-US (the default/fallback) is loaded eagerly. All other locales are
// fetched on demand when initI18n() is called with a non-default locale.
const i18nLocales: Record<string, any> = {
  null: enUS,
  'en-US': enUS,
};

// Locale ID → dynamic importer (data loaded on first use)
const localeLoaders: Record<string, () => Promise<any>> = {
  'zh-CN': () => import('../../locales/zh-CN.json'),
  ja: () => import('../../locales/ja.json'),
  'es-ES': () => import('../../locales/es-ES.json'),
  'de-DE': () => import('../../locales/de-DE.json'),
  'fr-FR': () => import('../../locales/fr-FR.json'),
  'it-IT': () => import('../../locales/it-IT.json'),
  'hi-IN': () => import('../../locales/hi-IN.json'),
  'ru-RU': () => import('../../locales/ru-RU.json'),
  'ar-SA': () => import('../../locales/ar-SA.json'),
};

// Supported locale IDs (used for matching without loading locale data)
const SUPPORTED_LOCALE_IDS = ['en-US', 'zh-CN', 'ja', 'es-ES', 'de-DE', 'fr-FR', 'it-IT', 'hi-IN', 'ru-RU', 'ar-SA'];

// Initialize intl eagerly with en-US to avoid warnings when t() is called
// before initI18n() completes.
intl.init({
  currentLocale: DEFAULT_LANG,
  locales: i18nLocales,
  fallbackLocale: DEFAULT_LANG,
  warningHandler: () => {}
});

export const locales = [
  { id: 'en-US', name: 'English' },
  { id: 'zh-CN', name: '中文' },
  { id: 'ja', name: '日本語' },
  { id: 'de-DE', name: 'Deutsch' },
  { id: 'es-ES', name: 'Español' },
  { id: 'fr-FR', name: 'Français' },
  { id: 'it-IT', name: 'Italiano' },
  { id: 'hi-IN', name: 'हिन्दी' },
  { id: 'ru-RU', name: 'Русский' },
  { id: 'ar-SA', name: 'العربية' }
];

// https://gist.github.com/ifthisandthat/496054
// see font class names in "index.css"
export const fontNames = [
  'Default',
  'Arial',
  'Arial Black',
  'Arial Narrow',
  'Bookman Old Style',
  'Cambria',
  'Century Gothic',
  'Comic Sans MS',
  'Consolas',
  'Constantina',
  'Courier New',
  'Garamond',
  'Georgia',
  'Helvetica Neue',
  'Impact',
  'Lucida Console',
  'Lucida Grande',
  'MS Sans Serif',
  'MS Serif',
  'Palatino Linotype',
  'Symbol',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Webdings',
  'Wingdings'
];
export const fontNameToClassName = (fontName: string) => {
  const className = 'font-' + fontName.toLowerCase().replace(/ /gi, '-');
  return className;
};

export const isWeb = !(window as any).__TAURI_INTERNALS__;
export const isLocalhost = () => window?.location?.hostname === 'localhost';

export enum OS {
  Unknown = 'UNKNOWN',
  Win = 'WIN',
  Mac = 'MAC',
  Linux = 'LINUX'
}

export const getOS = () => {
  let os = OS.Unknown;
  const ua = (navigator?.userAgent ?? '').toUpperCase();
  if (ua) {
    if (ua.indexOf(OS.Win) != -1) os = OS.Win;
    if (ua.indexOf(OS.Mac) != -1) os = OS.Mac;
    // if (ua.indexOf('X11') != -1) os = 'UNIX';
    if (ua.indexOf(OS.Linux) != -1) os = OS.Linux;
  }
  return os;
};

export const initI18n = async (userLocale = 'en-US') => {
  if (!userLocale) return;
  // Use matchSupportedLocale for prefix matching (e.g. 'ja-JP' → 'ja', 'zh' → 'zh-CN')
  const resolved = matchSupportedLocale(userLocale);
  // Load locale data on first use — skip if already cached or it's the default
  if (resolved !== DEFAULT_LANG && !i18nLocales[resolved]) {
    const loader = localeLoaders[resolved];
    if (loader) {
      const mod = await loader();
      i18nLocales[resolved] = mod.default ?? mod;
    }
  }
  intl.init({
    currentLocale: resolved,
    locales: i18nLocales,
    fallbackLocale: DEFAULT_LANG,
    warningHandler: () => {}
  });
};
export const t = (key: string, variables = {}) => intl.get(key, variables);

/**
 * Pick a folder name that doesn't collide with any existing sibling.
 * Appends " (2)", " (3)", … until a free name is found, matching macOS/Windows
 * Finder/Explorer conventions. Case-insensitive comparison so users on
 * case-insensitive filesystems (macOS default, Windows) can't smuggle a
 * collision past the check by varying case.
 */
export const dedupeFolderName = (existingNames: string[], base: string): string => {
  const used = new Set(existingNames.map((n) => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 10_000; i++) {
    const cand = `${base} (${i})`;
    if (!used.has(cand.toLowerCase())) return cand;
  }
  // Fallback — extremely unlikely. Use a timestamp so we don't block the user.
  return `${base} (${Date.now()})`;
};

/** Strip a trailing ".zip" extension (case-insensitive). */
export const stripZipExtension = (name: string): string =>
  name.replace(/\.zip$/i, '');

// replace non-standard chars from file/folder names with '_' chars
export const normalizeFileName = (name: string) => {
  let str = name
    // .replace(/[^a-z0-9_\-\s]/gi, '_') // this only check "non-alphabet" chars, not unicode chars (other langs)
    .replace(/[\!\@\#\$\%\^\&\*\)\(\+\=\.\<\>\{\}\[\]\:\;\'\"\|\~\`]/gi, '_') // replace special chars with '_'
    .replace(/_{2,}/g, '_') // replace two or more '_' with one '-'
    .trim();
  return str;
};

// check if Binderus empty initially (brand new user)
export const isEmptyInitially = (files: FileType[]) => {
  if (files.length === 0) {
    return true;
  }
  // Vault metadata is in .binderus/ (hidden, not in file list).
  const nonMeta = files.filter(f =>
    f.file_name !== VAULT_META_DIR &&
    f.file_name !== '.DS_Store'
  );
  if (nonMeta.length === 0) {
    return true;
  }
  return false;
};

export const focusEditor = (waitForEditor = false) => {
  setTimeout(
    () => {
      const els = document.getElementsByClassName('ProseMirror editor');
      if (els?.length > 0) {
        (els[0] as HTMLDivElement).focus();
      }
    },
    waitForEditor ? 50 : 0
  );
};

// enhance Editor with more functionalities like: handling link clicking, etc. using DOM
type EnhanceEditorType = {
  file: FileType;
  folder: FileType | null;
  internalLinkClicked: (el: HTMLAnchorElement) => void;
};
export const enhanceEditor = ({ file, folder, internalLinkClicked }: EnhanceEditorType) => {
  setTimeout(() => {
    // codeEditorEls (ReactCodeJar) => handle Global Shortcuts
    const codeEditorEls = document.querySelectorAll('[contenteditable="plaintext-only"]');
    if (codeEditorEls?.length > 0) {
      const codeEditor: HTMLDivElement = codeEditorEls[0] as HTMLDivElement;
      codeEditor.onkeyup = (e: KeyboardEvent) => {
        if (isGlobalShortcut(e)) {
          codeEditor.blur(); // blur editor so the app can handle the next global shortcut keys
        }
      };
    }

    // MilkDown editor
    const els = document.getElementsByClassName('ProseMirror editor');
    if (els?.length > 0) {
      const editor: HTMLDivElement = els[0] as HTMLDivElement;

      // handle App Shortcut => blur editor so App can handle those shortcuts:
      editor.onkeyup = (e: KeyboardEvent) => {
        if (isGlobalShortcut(e)) {
          editor.blur();
        }
      };

      // Unified link click handler (dispatched by ProseMirror linkClickHandler plugin —
      // works for all links including newly-typed ones without per-element onclick).
      // Remove previous listener to prevent stacking when enhanceEditor is called multiple times.
      const prev = (editor as any).__linkNavigateHandler;
      if (prev) editor.removeEventListener('link-navigate', prev);
      const handler = ((ev: CustomEvent) => {
        const href = (ev.detail?.href ?? '').trim();
        if (isExternalLink(href)) {
          open(href);
        } else if (href) {
          internalLinkClicked(ev.target as HTMLAnchorElement);
        }
      }) as EventListener;
      (editor as any).__linkNavigateHandler = handler;
      editor.addEventListener('link-navigate', handler);

      // get all "<img>" elements & process their "src" to point to local file paths.
      // Images with data-src are owned by paste-image-plugin's node view (which uses
      // Tauri v2 convertFileSrc); skip them to avoid overwriting with a raw v1-style
      // "asset://" URL that won't load.
      const imgEls = editor.querySelectorAll('img');
      imgEls.forEach(async (el: HTMLImageElement) => {
        if (el.hasAttribute('data-src')) return;
        if (isInternalLink(el.src)) {
          const { path } = splitFilePath(file?.file_path ?? ''); // keep path, remove fileName
          const basePath = file ? path : await getPath('', true);
          el.src = `asset://${basePath}/${sanitizeInternalLink(el.src)}`;
        }
      });
    }
  }, 100);
};

export const addItemtoRecentList = (list: FileType[], item: FileType) => {
  const newList = list.filter((obj) => obj.file_path !== item.file_path); // remove from existing recentList
  return [item, ...newList].slice(0, RECENT_LIST_MAX + 1); // then add to the top
};

export const setFavouriteItem = (list: FileType[], item: FileType, isAdding = true) => {
  const newList = list.filter((obj) => obj.file_path !== item?.file_path); // remove from existing favroutite file list
  if (isAdding) {
    return [item, ...newList].slice(0, FAVORITE_LIST_MAX + 1);
  } else {
    return [...newList].slice(0, FAVORITE_LIST_MAX + 1); // removed item from the list
  }
};

// MilkDown automatically append 'http://localhost:1420' to internal hyperlink's href
// This function will sanitize and return the original internal hyperlink's href
// Example: http://localhost:1420/directory/file1.md => output: /directory/file1.md
export const sanitizeInternalLink = (href = '') => {
  let str = href.replace('wikilink://', ''); // wikilink://target → target
  str = str.replaceAll('tauri://localhost', ''); // in PROD, it looks like: "tauri://localhost/file1.md" (Mac Prod)
  str = str.replaceAll('tauri.localhost', 'localhost'); // for Win PROD, it looks like: "https://tauri.localhost/file1.md"
  str = str.replaceAll('https://', 'http://');
  str = str.replaceAll(':1420', '');
  str = str.replace(/http\:\/\/localhost/, '');
  str = str.replaceAll('%20', ' ');
  return str;
};

export const isInternalLink = (href = '') => {
  const arr1 = href.split('//');
  if (arr1.length > 1) {
    const arr2 = arr1[1].split('/');
    if (arr2.length > 0 && arr2[0].indexOf('localhost') >= 0) {
      return true;
    }
  }
  return false;
};

export const isExternalLink = (href = '') => {
  const hrefStr = href.trim();
  return hrefStr.startsWith('http') === true && hrefStr.indexOf('localhost') < 0;
};

export const validateEmail = (email: string) => {
  var re = /\S+@\S+\.\S+/;
  return re.test(email);
};

export const getUserLocale = () => {
  const langs = (navigator as any).languages ?? [];
  if (langs.length > 0) {
    return langs[0];
  }
  return [];
};

// Map raw OS/browser locale to a supported app locale, falling back to DEFAULT_LANG.
// Tries exact match first, then language-prefix match (e.g. "zh" → "zh-CN").
export const matchSupportedLocale = (rawLocale: string): string => {
  if (!rawLocale) return DEFAULT_LANG;
  const supported = SUPPORTED_LOCALE_IDS;
  if (supported.includes(rawLocale)) return rawLocale;
  // prefix match: "zh" → "zh-CN", "es" → "es-ES"
  const prefix = rawLocale.split('-')[0].toLowerCase();
  const prefixMatch = supported.find(s => s.toLowerCase().startsWith(prefix + '-') || s.toLowerCase() === prefix);
  return prefixMatch ?? DEFAULT_LANG;
};

// Build User Guide URL with the current locale (e.g. https://www.binderus.com/how-to?lang=ja)
export const getUserGuideUrl = (lang: string): string => {
  const l = lang || DEFAULT_LANG;
  return `${USER_GUIDE_BASE_URL}?lang=${encodeURIComponent(l)}`;
};

// check if user pressed a Global Shortcut Key
export const isGlobalShortcut = (e: KeyboardEvent | React.KeyboardEvent<HTMLInputElement>) => {
  const os = getOS();
  // Cmd on Mac ~ Ctrl on Windows
  // https://support.microsoft.com/en-us/topic/keyboard-mappings-using-a-pc-keyboard-on-a-macintosh-d4fd87ca-8762-30ee-fcde-08ffe95faea3
  // https://support.apple.com/guide/mac-help/windows-keys-on-a-mac-keyboard-cpmh0152/mac
  if (os === OS.Mac) {
    if (e.metaKey && [',', '.', '\\', '/', 'p'].includes(e.key)) {
      return true;
    }
  } else {
    if (e.ctrlKey && [',', '.', '\\', '/', 'p'].includes(e.key)) {
      return true;
    }
  }
  return false;
};

const IMAGE_EXTENSIONS = new Set([
  '.bmp', '.png', '.apng', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.avif',
]);

/**
 * True when `fileName` ends with a known image extension. Uses strict
 * extension matching (last dot onward) so names like `foo.pngnotes.md`
 * don't falsely match, unlike a naive `indexOf('.png') > 0`.
 */
export const isImageFile = (fileName: string) => {
  const lc = (fileName ?? '').toLowerCase();
  const dot = lc.lastIndexOf('.');
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(lc.slice(dot));
};

const MEDIA_EXTENSIONS = new Set([
  // video
  '.mp4', '.webm', '.mov', '.mkv',
  // audio
  '.mp3', '.ogg', '.wav', '.m4a', '.flac',
]);

/**
 * True when `fileName` is a binary media/image file that should be rendered
 * directly from disk (no UTF-8 text read). Tab-loading code uses this to
 * skip `read_file`, which would throw on binary bytes.
 */
export const isBinaryMediaFile = (fileName: string) => {
  if (isImageFile(fileName)) return true;
  const lc = (fileName ?? '').toLowerCase();
  const dot = lc.lastIndexOf('.');
  if (dot < 0) return false;
  return MEDIA_EXTENSIONS.has(lc.slice(dot));
};

// detect if a file is a code file; also used for Prism highlight fn;
export const getCodeLang = (fileName: string) => {
  let lang = '';
  if (fileName.includes('.js') || fileName.includes('.jsx') || fileName.includes('.ts') || fileName.includes('.tsx')) {
    lang = 'javascript';
  } else if (fileName.includes('.html') || fileName.includes('.htm')) {
    lang = 'html';
  } else if (fileName.includes('.css')) {
    lang = 'css';
  } else if (fileName.includes('.java')) {
    lang = 'java';
  } else if (fileName.includes('.py')) {
    lang = 'shell';
  } else if (fileName.includes('.rb')) {
    lang = 'ruby';
  } else if (fileName.includes('.rs')) {
    lang = 'rust';
  } else if (fileName.includes('.yaml')) {
    lang = 'yaml';
  } else if (fileName.includes('.json')) {
    lang = 'json';
  } else if (fileName.includes('.sh')) {
    lang = 'bash';
  } else if (fileName.includes('.bat')) {
    lang = 'batch';
  } else if (fileName.includes('.ps1') || fileName.includes('.psm1')) {
    lang = 'powershell';
  } else if (fileName.includes('.h') || fileName.includes('.cpp') || fileName.includes('.cs')) {
    lang = 'c';
  } else if (fileName.includes('.php')) {
    lang = 'php';
  } else if (fileName.includes('.sql')) {
    lang = 'sql';
  } else if (fileName.includes('.go')) {
    lang = 'go';
  }
  return lang;
};

/** Strip the base data directory prefix from a full file path for display. */
export const getRelativePath = (filePath: string, basePath: string): string => {
  const normalized = (filePath ?? '').replace(/\\/g, '/');
  const normalizedBase = (basePath ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalizedBase && normalized.startsWith(normalizedBase + '/')) {
    return normalized.slice(normalizedBase.length + 1);
  }
  return normalized;
};

export const splitFilePath = (filePath: string) => {
  const normalizedPath = (filePath ?? '').replace(/\\/g, '/');
  const arr = normalizedPath.split('/');
  const path = arr.slice(0, -1).join('/'); // keep path, remove fileName
  const fileName = arr[arr.length - 1];
  return { path, fileName };
};

export const extractParentPath = (filePath: string): string => {
  const { path } = splitFilePath(filePath);
  return path;
};

export const updateCssVar = (cssVarName: string, value: string) => {
  const cssRoot = document.querySelector(':root');
  (cssRoot as HTMLElement)?.style?.setProperty(`--${cssVarName}`, value);
};

/** Lightweight debounce — drop-in replacement for lodash/debounce (trailing-edge only).
 *  .cancel() discards pending call; .flush() fires it immediately and returns its result. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const debounce = <T extends (...args: any[]) => any>(fn: T, ms: number): T & { cancel: () => void; flush: () => ReturnType<T> | undefined } => {
  let id: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;
  const debounced = (...args: Parameters<T>) => {
    lastArgs = args;
    if (id) clearTimeout(id);
    id = setTimeout(() => { lastArgs = null; fn(...args); }, ms);
  };
  debounced.cancel = () => { if (id) { clearTimeout(id); id = null; lastArgs = null; } };
  debounced.flush = () => {
    if (id && lastArgs) {
      clearTimeout(id);
      id = null;
      const args = lastArgs;
      lastArgs = null;
      return fn(...args);
    }
    return undefined;
  };
  return debounced as T & { cancel: () => void; flush: () => ReturnType<T> | undefined };
};

export const updateCustomStylesClassname = (editorColor: string, editorBgColor: string) => {
  (window as any).document.querySelector('body').classList.remove('custom-styles');
  if (editorColor || editorBgColor) {
    (window as any).document.querySelector('body').classList.add('custom-styles');
  }
  if (editorColor) {
    updateCssVar('editor-color', editorColor);
  }
  if (editorBgColor) {
    updateCssVar('editor-bg-color', editorBgColor);
  }
};
