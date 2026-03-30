import React from 'react';
import { useAppStore } from './use-app-store';

// Backward-compatible hook — all consumers keep using useAppContext()
export const useAppContext = () => useAppStore();

// No-op wrapper for backward compatibility with main.tsx
export const AppContextProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
