import { ReactNode } from 'react';
import { toast as reactToast } from 'react-toastify';

export const toastInfo = (message: ReactNode) => {
  reactToast(message, { type: 'info' });
};

// Toast a success message - first, include <Toaster /> in JSX.
export const toastSuccess = (message: ReactNode, onClick?: () => void) => {
  reactToast(message, { type: 'success', ...(onClick ? { onClick, style: { cursor: 'pointer' } } : {}) });
};

// Toast an error message - first, include <Toaster /> in JSX.
export const toastError = (message: ReactNode, onClick?: (message: ReactNode) => void) => {
  try {
    if (onClick) {
      reactToast(message, {
        type: 'error',
        onClick: () => onClick(message)
      });
    } else {
      reactToast(message, {
        type: 'error'
      });
    }
  } catch (err) {
    console.error(err);
  }
};

// Toast a warning message - first, include <Toaster /> in JSX.
export const toastWarning = (message: ReactNode) => {
  reactToast(message, { type: 'warning' });
};
