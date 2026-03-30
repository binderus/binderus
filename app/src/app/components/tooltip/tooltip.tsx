import { useState, ReactNode } from 'react';
import { useFloating, offset, flip, shift, useHover, useFocus, useDismiss, useRole, useInteractions } from '@floating-ui/react';

interface Props {
  content: string;
  children: ReactNode;
}

export const Tooltip = ({ content, children }: Props) => {
  const [isOpen, setIsOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [offset(6), flip(), shift()]
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context),
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: 'tooltip' })
  ]);

  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps({ onClick: () => setIsOpen(false) })} className="inline-flex items-center">
        {children}
      </span>
      {isOpen && (
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          className="max-w-xs bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg z-50"
          {...getFloatingProps()}
        >
          {content}
        </div>
      )}
    </>
  );
};
