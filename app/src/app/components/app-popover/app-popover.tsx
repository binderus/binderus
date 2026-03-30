import { Popover } from '@headlessui/react';
import { ReactNode } from 'react';

interface Props {
  buttonNode: ReactNode;
  content: ReactNode;
  onConfirm: (e: any) => void;
}

export default ({ buttonNode, content, onConfirm }: Props) => {
  return (
    <Popover className="relative inline-flex items-center">
      {({ open }) => (
        <>
          <Popover.Button as="div" className="inline-flex items-center">{buttonNode}</Popover.Button>
          {open && (
            <div>
              <Popover.Panel className="absolute right-0 z-10 w-48 flex">{content}</Popover.Panel>
            </div>
          )}
        </>
      )}
    </Popover>
  );
};
