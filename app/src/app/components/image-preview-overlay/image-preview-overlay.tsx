/**
 * Description: Full-window image preview overlay with an inline description
 *   editor. Mount once at the app root; call `showImagePreview({...})` from
 *   anywhere. When `filePath` is provided, loads existing description from the
 *   metadata store and offers a textarea + Save button that writes both to
 *   metadata (`invoke('set_file_metadata')`) and back to the caller via
 *   `onAltChange` so the image node's markdown alt stays in sync.
 * Requirements: @headlessui/react, @tauri-apps/api/core (invoke), base-utils (t).
 * Inputs: showImagePreview({ src, filePath?, initialAlt?, onAltChange? }).
 *   - `src` is the webview-loadable URL (asset://, bin-img://, data:, https:, blob:).
 *   - `filePath` is the absolute vault path. Omit to disable description editing.
 *   - `initialAlt` is used when metadata has nothing stored yet.
 *   - `onAltChange(newDescription)` updates the image node's alt attribute in the editor.
 * Outputs: Imperative API. Resolves nothing — writes via callback + invoke.
 */
import { Dialog, DialogPanel, Transition } from '@headlessui/react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../utils/base-utils';

type OpenState = {
  src: string;
  filePath?: string;
  initialAlt?: string;
  onAltChange?: (newAlt: string) => void;
};

let open: ((state: OpenState) => void) | null = null;

export function showImagePreview(opts: OpenState | string): void {
  if (!open) return;
  const state = typeof opts === 'string' ? { src: opts } : opts;
  if (!state.src) return;
  open(state);
}

type FileMetadata = {
  description?: string | null;
  summary?: string | null;
};

export default function ImagePreviewOverlay() {
  const [state, setState] = useState<OpenState | null>(null);
  const [description, setDescription] = useState('');
  const [savedDescription, setSavedDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    open = (s) => {
      if (mounted.current) setState(s);
    };
    return () => {
      mounted.current = false;
      open = null;
    };
  }, []);

  // Load existing metadata when opening; fall back to initialAlt from the
  // markdown node. Metadata is treated as authoritative so the same image
  // referenced from multiple notes shows one consistent description.
  useEffect(() => {
    if (!state) {
      setDescription('');
      setSavedDescription('');
      return;
    }
    const initial = state.initialAlt ?? '';
    setDescription(initial);
    setSavedDescription(initial);
    if (!state.filePath) return;
    let cancelled = false;
    invoke<FileMetadata | null>('get_file_metadata', { filePath: state.filePath })
      .then((meta) => {
        if (cancelled || !mounted.current) return;
        const stored = meta?.description ?? null;
        if (stored != null) {
          setDescription(stored);
          setSavedDescription(stored);
        }
      })
      .catch(() => {
        /* tolerate — keep the initialAlt fallback already set */
      });
    return () => { cancelled = true; };
  }, [state?.filePath, state?.src]);

  const close = () => setState(null);

  const save = async () => {
    if (!state?.filePath || saving) return;
    setSaving(true);
    try {
      await invoke('set_file_metadata', {
        filePath: state.filePath,
        description,
        summary: null,
      });
      state.onAltChange?.(description);
      setSavedDescription(description);
    } catch {
      // Caller is responsible for toasting if they want UI feedback.
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  // Keyboard: Enter saves (single-line input — no newline to preserve).
  // Esc is handled by Headless UI onClose.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    }
  };

  const isOpen = state !== null;
  const canEditDescription = !!state?.filePath;
  const isDirty = description !== savedDescription;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="fixed inset-0 z-50" onClose={close}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/85" aria-hidden="true" />
        </Transition.Child>

        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <DialogPanel
            // Backdrop click (on the panel, not image/form) closes.
            className="fixed inset-0 flex flex-col items-center justify-center gap-4 p-6 outline-none"
            onClick={close}
          >
            {state && (
              <>
                <img
                  src={state.src}
                  alt={description}
                  onClick={close}
                  // Leave room for the description caption + editor below.
                  style={{
                    maxWidth: '100%',
                    maxHeight: canEditDescription ? '70vh' : '90vh',
                    objectFit: 'contain',
                    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.6)',
                    borderRadius: '6px',
                    cursor: 'zoom-out',
                  }}
                />
                {canEditDescription && (
                  <div
                    // Click inside the editor should NOT close the overlay.
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: 'min(720px, 90vw)',
                      display: 'flex',
                      alignItems: 'flex-end',
                      gap: '8px',
                    }}
                  >
                    <input
                      id="binderus-image-description"
                      type="text"
                      aria-label={t('PASTE_IMAGE_DESCRIPTION_LABEL')}
                      value={description}
                      // Strip any pasted line breaks so the single-line
                      // contract holds even when users paste multiline text.
                      onChange={(e) => setDescription(e.target.value.replace(/[\r\n]+/g, ' '))}
                      onKeyDown={onKeyDown}
                      placeholder={t('PASTE_IMAGE_DESCRIPTION_PLACEHOLDER')}
                      // Subtle inline styling: transparent background, thin
                      // rule only at the bottom so the field reads as a
                      // caption under the image rather than a form field.
                      style={{
                        flex: 1,
                        background: 'transparent',
                        color: '#fff',
                        border: 'none',
                        borderBottom: '1px solid rgba(255,255,255,0.3)',
                        outline: 'none',
                        fontSize: '13px',
                        lineHeight: '1.4',
                        padding: '4px 0',
                        fontFamily: 'inherit',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void save()}
                      disabled={saving || !isDirty}
                      title={t('TEXT_SAVE')}
                      aria-label={t('TEXT_SAVE')}
                      style={{
                        background: 'transparent',
                        color: '#fff',
                        border: 'none',
                        cursor: isDirty && !saving ? 'pointer' : 'not-allowed',
                        opacity: isDirty && !saving ? 0.9 : 0.35,
                        padding: '4px 6px',
                        fontSize: '12px',
                        fontFamily: 'inherit',
                      }}
                    >
                      {saving ? t('TEXT_SENDING') : t('TEXT_SAVE')}
                    </button>
                  </div>
                )}
              </>
            )}
          </DialogPanel>
        </Transition.Child>
      </Dialog>
    </Transition>
  );
}
