import { Popover } from '@headlessui/react';
import { ReactNode, useState } from 'react';

interface Props {
  buttonNode: ReactNode;
  confirmText: string;
  onConfirm: (e: any, text: string) => void;
  placeholder?: string;
}

export default ({ buttonNode, confirmText, onConfirm, placeholder }: Props) => {
  const [text, setText] = useState('');

  const onKeyUp = (e: React.KeyboardEvent<HTMLInputElement>, close: any) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onConfirm(e, text);
      close();
      setText('');
    }
  };

  return (
    <Popover className="relative">
      {({ open, close }) => (
        <>
          <Popover.Button as="div">{buttonNode}</Popover.Button>
          {open && (
            <div>
              <Popover.Panel className="absolute right-0 z-10 w-52 flex">
                <div className="popover-panel p-3">
                  <input
                    autoFocus
                    onChange={(e) => setText(e.target.value)}
                    className="input-dark"
                    placeholder={placeholder}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    onKeyUp={(e) => onKeyUp(e, close)}
                  />
                  <button
                    className="btn btn-primary mt-2"
                    onClick={(e) => {
                      onConfirm(e, text);
                      close();
                      setText('');
                    }}
                  >
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
