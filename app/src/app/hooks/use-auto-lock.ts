/**
 * Description: Auto-lock hook that locks the database after a period of inactivity.
 *   Only active when encryption is enabled and the storage backend is libsql.
 * Requirements: Tauri app with lock_db command; encryptionEnabled and storageBackend in app store.
 * Inputs: Reads autoLockTimeout, encryptionEnabled, isLocked, storageBackend from app context.
 * Outputs: Calls lockDb() and setIsLocked(true) after inactivity timeout.
 */
import { useEffect, useRef } from 'react';
import { useAppContext } from './use-app-context';
import { lockDb } from '../utils/tauri-utils';

export function useAutoLock() {
  const { autoLockTimeout, encryptionEnabled, isLocked, setIsLocked, storageBackend } = useAppContext();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!encryptionEnabled || isLocked || autoLockTimeout === 0 || storageBackend !== 'libsql') return;
    timerRef.current = setTimeout(() => {
      lockDb();
      setIsLocked(true);
    }, autoLockTimeout * 60 * 1000);
  };

  useEffect(() => {
    if (!encryptionEnabled || storageBackend !== 'libsql') return;
    const events = ['mousemove', 'keydown', 'click'];
    events.forEach((e) => document.addEventListener(e, resetTimer));
    resetTimer();
    return () => {
      events.forEach((e) => document.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [encryptionEnabled, isLocked, autoLockTimeout, storageBackend]);
}
