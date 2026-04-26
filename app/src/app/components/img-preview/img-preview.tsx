/**
 * Description: Full-tab image viewer used when the user opens an image file
 *   from the sidebar. Resolves the source URL via `resolveImageSrc` so it
 *   works for both FS mode (asset:// via convertFileSrc) and DB mode
 *   (bin-img:// URI scheme streaming bytes from libsql). Fits the image to
 *   the viewport, shows a framed border so the bounds are visible against
 *   dark/light backgrounds, and publishes natural dimensions into the
 *   `useImagePreviewInfo` store so the status bar can display them.
 * Requirements: resolveImageSrc from image-utils; vault path set on app init.
 * Inputs:  url (absolute OS path from the active tab's file_path),
 *          className (optional extra classes on the outer container).
 * Outputs: <img> inside a framed, scrollable container with a broken-image
 *          fallback. Also writes { width, height, filePath } to
 *          useImagePreviewInfo on successful load.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { resolveImageSrc } from '../../utils/image-utils';
import { getVaultPath } from '../../utils/tauri-utils';
import { t } from '../../utils/base-utils';

interface Props {
  url: string;
  className?: string;
}

interface ImagePreviewInfoState {
  filePath: string | null;
  width: number;
  height: number;
  set: (info: { filePath: string; width: number; height: number }) => void;
  clear: () => void;
}

/** Lightweight store for the active image tab's natural dimensions. Cleared
 *  when the image unmounts or a load error happens. Consumed by `StatusBar`
 *  to render `1920 × 1080` next to the cursor/editor-mode indicators. */
export const useImagePreviewInfo = create<ImagePreviewInfoState>((set) => ({
  filePath: null,
  width: 0,
  height: 0,
  set: (info) => set(info),
  clear: () => set({ filePath: null, width: 0, height: 0 }),
}));

/** Convert an absolute OS path (or already-vault-relative path) into a
 *  vault-root-absolute POSIX path like `/notes/foo.png`. Works for both
 *  macOS/Linux `/` paths and Windows `\` paths. */
function toVaultRelativeSrc(absPath: string): string {
  const norm = absPath.replace(/\\/g, '/');
  const vault = getVaultPath().replace(/\\/g, '/').replace(/\/+$/, '');
  if (vault && norm.startsWith(vault + '/')) {
    return norm.slice(vault.length);
  }
  return norm.startsWith('/') ? norm : `/${norm}`;
}

export default function ImgPreview({ url, className }: Props) {
  const [errored, setErrored] = useState(false);
  const src = resolveImageSrc(toVaultRelativeSrc(url));
  const basename = url.split(/[\\/]/).pop() ?? url;

  // Clear dimensions when the component unmounts or the file changes, so the
  // status bar doesn't show stale width × height after closing/switching.
  useEffect(() => {
    return () => useImagePreviewInfo.getState().clear();
  }, [url]);

  // Checker background (two 8×8 tiles) so alpha pixels stay visible against
  // the surrounding panel chrome. Inlined so the component stays self-contained.
  const checker =
    'repeating-conic-gradient(var(--checker-fg, rgba(255,255,255,0.06)) 0% 25%, var(--checker-bg, transparent) 0% 50%) 50% / 16px 16px';

  return (
    <div
      className={`flex-1 min-h-0 overflow-auto flex items-center justify-center p-4 ${className ?? ''}`}
    >
      {errored ? (
        <div className="text-sm opacity-70 select-none">
          {t('TEXT_IMAGE_LOAD_FAILED', { name: basename })}
        </div>
      ) : (
        <img
          src={src}
          alt={basename}
          onLoad={(e) => {
            const img = e.currentTarget;
            useImagePreviewInfo.getState().set({
              filePath: url,
              width: img.naturalWidth,
              height: img.naturalHeight,
            });
          }}
          onError={() => {
            useImagePreviewInfo.getState().clear();
            setErrored(true);
          }}
          className="max-w-full max-h-full object-contain rounded-md shadow-md"
          style={{
            background: checker,
            border: '1px solid var(--border-primary, rgba(255,255,255,0.18))',
            imageRendering: 'auto',
          }}
        />
      )}
    </div>
  );
}
