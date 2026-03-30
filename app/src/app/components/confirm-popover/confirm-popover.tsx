import { Popover } from '@headlessui/react';
import { ReactNode } from 'react';

interface Props {
  buttonNode: ReactNode;
  confirmText: string;
  onConfirm: (e: any) => void;
}

export default ({ buttonNode, confirmText, onConfirm }: Props) => {
  return (
    <Popover className="relative">
      {({ open }) => (
        <>
          <Popover.Button as="div">{buttonNode}</Popover.Button>
          {open && (
            <div>
              <Popover.Panel className="absolute z-10 w-48 flex">
                <div className="popover-panel p-3">
                  <button className="btn btn-danger" onClick={onConfirm}>
                    {confirmText}
                  </button>
                </div>
              </Popover.Panel>
            </div>
          )}
        </>
      )}
    </Popover>
  );
};
