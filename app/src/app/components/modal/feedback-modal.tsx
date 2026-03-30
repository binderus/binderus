import { Dialog, DialogPanel, DialogTitle, Transition } from '@headlessui/react';
import { Fragment, useState } from 'react';
import { t } from '../../utils/base-utils';
import Spinner from '../spinner/spinner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function FeedbackModal({ isOpen, onClose }: Props) {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <>
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

            {/* This element is to trick the browser into centering the modal contents. */}
            <span className="inline-block h-screen align-middle" aria-hidden="true">
              &#8203;
            </span>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel
                className="dialog-panel relative z-10 inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform shadow-xl rounded-2xl"
                style={{ maxWidth: '50vw' }}
              >
                <DialogTitle
                  as="h3"
                  className="dialog-title flex items-center justify-between text-lg font-medium leading-6"
                >
                  <div>{t('APP_MAIN_FEEDBACK_TITLE')}</div>
                  {isLoading ? (
                    <div>
                      <Spinner />
                    </div>
                  ) : null}
                </DialogTitle>

                <div className="mt-2">
                  <iframe
                    className="w-full"
                    style={{ height: '70vh' }}
                    src="https://forms.gle/VNzYQPLCgYDkJ29t9"
                    onLoad={() => setIsLoading(false)}
                  />
                </div>

                <div className="mt-4">
                  <button
                    type="button"
                    className="btn btn-modal"
                    onClick={onClose}
                  >
                    {t('TEXT_OK')}
                  </button>
                </div>
              </DialogPanel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}
