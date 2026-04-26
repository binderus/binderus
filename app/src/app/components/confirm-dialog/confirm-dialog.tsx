/**
 * Description: Reusable app-styled confirmation dialog. Replaces the OS-native Tauri
 *   `ask`/`confirm` dialogs so destructive prompts match the app's modal design.
 *   Exposes an imperative `showConfirm(opts)` that returns Promise<boolean> — mount
 *   the single `<ConfirmDialog />` once at the app root; subsequent callers await
 *   the promise from anywhere (including non-React code like ProseMirror plugins).
 * Requirements: @headlessui/react (existing dep); react-intl-universal via base-utils.
 * Inputs: showConfirm({ title?, message, confirmText?, cancelText?, danger? }).
 * Outputs: Promise<boolean> that resolves true on confirm, false on cancel/dismiss.
 */
import { Dialog, DialogPanel, DialogTitle, Transition } from '@headlessui/react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { t } from '../../utils/base-utils';

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Style the confirm button as destructive (red). Default false. */
  danger?: boolean;
  /** Alert mode — hide the cancel button so the dialog acts as an "OK-only" notice. */
  hideCancel?: boolean;
};

type OpenState = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

// Module-scoped bridge so non-React callers (ProseMirror plugins, util fns) can
// await `showConfirm(...)`. The bridge is wired by `<ConfirmDialog />` on mount
// and cleared on unmount. If no instance is mounted, `showConfirm` resolves false.
let open: ((state: OpenState) => void) | null = null;

export function showConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!open) {
      resolve(false);
      return;
    }
    open({ ...opts, resolve });
  });
}

/**
 * Alert-style one-button dialog built on top of the confirm dialog — drop-in
 * replacement for native `alert()` so the UI matches the rest of the app.
 * Resolves when the user clicks OK (or dismisses via escape / backdrop).
 */
export function showAlert(opts: { title?: string; message: string; confirmText?: string }): Promise<void> {
  return showConfirm({
    title: opts.title,
    message: opts.message,
    confirmText: opts.confirmText ?? t('TEXT_OK'),
    hideCancel: true,
  }).then(() => undefined);
}

export default function ConfirmDialog() {
  const [state, setState] = useState<OpenState | null>(null);
  // Reject stale promises on unmount so callers never hang.
  const pendingResolve = useRef<OpenState['resolve'] | null>(null);

  useEffect(() => {
    open = (s) => {
      pendingResolve.current = s.resolve;
      setState(s);
    };
    return () => {
      open = null;
      pendingResolve.current?.(false);
      pendingResolve.current = null;
    };
  }, []);

  const close = (ok: boolean) => {
    // Capture the current resolver before clearing state so the promise
    // resolves with the user's choice even after the dialog unmounts.
    const resolver = pendingResolve.current;
    pendingResolve.current = null;
    setState(null);
    resolver?.(ok);
  };

  const isOpen = state !== null;
  const title = state?.title ?? t('TEXT_CONFIRM');
  const message = state?.message ?? '';
  const confirmText = state?.confirmText ?? t('TEXT_YES');
  const cancelText = state?.cancelText ?? t('TEXT_NO');
  const danger = state?.danger ?? false;
  const hideCancel = state?.hideCancel ?? false;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="fixed inset-0 z-50 overflow-y-auto" onClose={() => close(false)}>
        <div className="min-h-screen px-4 text-center">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40" />
          </Transition.Child>

          <span className="inline-block h-screen align-middle" aria-hidden="true">&#8203;</span>

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
              className="dialog-panel relative z-10 inline-block w-full max-w-sm p-6 my-8 text-left align-middle transition-all transform shadow-xl rounded-2xl"
            >
              <DialogTitle as="h3" className="dialog-title text-lg font-semibold leading-6">
                {title}
              </DialogTitle>

              {/* `overflowWrap: anywhere` lets long unbroken tokens (file paths, URLs)
                  wrap inside the dialog instead of overflowing past the panel edge. */}
              <div className="mt-3 text-sm opacity-80" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {message}
              </div>

              <div className="mt-6 flex justify-end gap-2">
                {!hideCancel && (
                  <button
                    type="button"
                    className="dialog-btn"
                    onClick={() => close(false)}
                    autoFocus
                  >
                    {cancelText}
                  </button>
                )}
                <button
                  type="button"
                  className="dialog-btn"
                  onClick={() => close(true)}
                  autoFocus={hideCancel}
                  style={
                    danger
                      ? { background: 'var(--danger-bg, #dc2626)', color: '#fff' }
                      : undefined
                  }
                >
                  {confirmText}
                </button>
              </div>
            </DialogPanel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
