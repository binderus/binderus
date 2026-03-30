// Description: Modal dialog wrapping the reusable FolderTree component for selecting
//   a destination folder (e.g. when moving files). Manages its own selectedPath state
//   and exposes a confirm/cancel interface.
// Requirements: @headlessui/react Dialog, FolderTree component
// Inputs: isOpen, rootPath, confirmLabel (button text), onSelect(destPath), onClose
// Outputs: Calls onSelect with the chosen folder path when confirmed

import { Dialog, DialogPanel, DialogTitle, Transition } from '@headlessui/react';
import { Fragment, useEffect, useState } from 'react';
import FolderTree from '../folder-tree/folder-tree';
import { t } from '../../utils/base-utils';

interface Props {
  isOpen: boolean;
  rootPath: string;
  /** Label for the confirm button. Defaults to TEXT_MOVE_TO_FOLDER. */
  confirmLabel?: string;
  onSelect: (destPath: string) => void;
  onClose: () => void;
}

export default function FolderTreeModal({ isOpen, rootPath, confirmLabel, onSelect, onClose }: Props) {
  const [selectedPath, setSelectedPath] = useState(rootPath);

  // Reset selection whenever the modal opens or rootPath changes
  useEffect(() => {
    if (isOpen) setSelectedPath(rootPath);
  }, [isOpen, rootPath]);

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
            <DialogPanel className="dialog-panel relative z-10 inline-block w-full max-w-sm p-4 my-8 text-left align-middle transition-all transform rounded-lg shadow-xl">
              <DialogTitle className="text-lg font-medium mb-3">
                {t('TEXT_SELECT_DESTINATION')}
              </DialogTitle>

              <div className="border border-gray-600 rounded p-2 overflow-y-auto" style={{ maxHeight: '300px' }}>
                <FolderTree
                  rootPath={rootPath}
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                />
              </div>

              <div className="flex justify-end gap-2 mt-4">
                <button className="btn" onClick={onClose}>
                  {t('TEXT_CANCEL')}
                </button>
                <button className="btn btn-primary" onClick={() => onSelect(selectedPath)}>
                  {confirmLabel ?? t('TEXT_MOVE_TO_FOLDER')}
                </button>
              </div>
            </DialogPanel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
