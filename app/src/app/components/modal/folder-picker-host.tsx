// Description: Imperative wrapper around FolderTreeModal so non-React callers
//   (ProseMirror plugins, util fns) can `await showFolderPicker(...)` to pick a
//   folder. Mirrors the showConfirm bridge pattern — mount <FolderPickerHost />
//   once at the app root and any caller can request a picker.
// Requirements: FolderTreeModal, getPath() from tauri-utils to resolve the
//   default vault root when the caller doesn't pass one.
// Inputs: showFolderPicker({ rootPath?, confirmLabel? })
// Outputs: Promise<string | null> resolving to the selected folder, or null on cancel.

import { useEffect, useRef, useState } from 'react';
import FolderTreeModal from './folder-tree-modal';
import { getPath } from '../../utils/tauri-utils';

interface PickerOptions {
  rootPath?: string;
  confirmLabel?: string;
}

interface OpenState extends PickerOptions {
  rootPath: string;
  resolve: (value: string | null) => void;
}

let open: ((state: OpenState) => void) | null = null;

export function showFolderPicker(opts: PickerOptions = {}): Promise<string | null> {
  return new Promise(async (resolve) => {
    if (!open) { resolve(null); return; }
    // Fall back to the vault root when caller didn't supply one.
    const rootPath = opts.rootPath ?? (await getPath('', true));
    if (!rootPath) { resolve(null); return; }
    open({ ...opts, rootPath, resolve });
  });
}

export default function FolderPickerHost() {
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
      pendingResolve.current?.(null);
      pendingResolve.current = null;
    };
  }, []);

  const close = (path: string | null) => {
    const resolver = pendingResolve.current;
    pendingResolve.current = null;
    setState(null);
    resolver?.(path);
  };

  if (!state) return null;

  return (
    <FolderTreeModal
      isOpen={true}
      rootPath={state.rootPath}
      confirmLabel={state.confirmLabel}
      onSelect={(p) => close(p)}
      onClose={() => close(null)}
    />
  );
}
