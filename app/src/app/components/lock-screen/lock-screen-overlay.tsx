/**
 * Description: Fullscreen lock screen overlay for Binderus encrypted database.
 *   Blocks all app interaction when the DB is locked. User must enter passphrase
 *   to unlock. After 3 failed attempts, offers to reset the app to filesystem mode.
 * Requirements: Tauri app with unlock_db command registered in backend.
 * Inputs: None (reads isLocked from app context)
 * Outputs: Calls unlockDb() on correct passphrase, sets isLocked=false
 */
import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { FiLock, FiEye, FiEyeOff } from 'react-icons/fi';
import { useAppContext } from '../../hooks/use-app-context';
import { unlockDb, resetToFilesystem, quitApp } from '../../utils/tauri-utils';
import { t } from '../../utils/base-utils';

const MAX_ATTEMPTS = 3;

export default function LockScreenOverlay() {
  const { setIsLocked, setFolderStack, setRefreshFolder } = useAppContext();
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const handleUnlock = async () => {
    setError('');
    try {
      await unlockDb(passphrase);
      setIsLocked(false);
      setFolderStack([]);
      setRefreshFolder(true);
    } catch (err: any) {
      const next = failedAttempts + 1;
      setFailedAttempts(next);
      const detail = typeof err === 'string' ? err : (err?.message ?? 'Incorrect passphrase');
      setError(next >= MAX_ATTEMPTS
        ? `${detail} (${next} failed attempts)`
        : `${detail} (${MAX_ATTEMPTS - next} attempt${MAX_ATTEMPTS - next === 1 ? '' : 's'} remaining)`
      );
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      setPassphrase('');
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleUnlock();
  };

  const handleResetToFs = async () => {
    await resetToFilesystem();
    await quitApp();
  };

  return createPortal(
    <div className="flex items-center justify-center" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--bg-primary)' }}>
      <div className="flex flex-col items-center gap-4 p-8 rounded-2xl shadow-2xl" style={{ background: 'var(--bg-primary)', minWidth: 320, maxWidth: 400, width: '90%' }}>
        <FiLock size={40} className="opacity-70" />
        <div className="text-xl font-semibold">{t('LOCK_TITLE')}</div>
        <div className="text-sm opacity-60 text-center">{t('LOCK_SUBTITLE')}</div>

        {!confirmReset ? (
          <>
            <div className={`relative w-full ${shaking ? 'shake' : ''}`}>
              <input
                ref={inputRef}
                type={showPassphrase ? 'text' : 'password'}
                className="dialog-input w-full pr-10"
                placeholder={t('LOCK_ENTER_PASSPHRASE')}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="absolute right-2 inset-y-0 flex items-center opacity-60 hover:opacity-100"
                onClick={() => setShowPassphrase((v) => !v)}
                tabIndex={-1}
              >
                {showPassphrase ? <FiEyeOff size={16} /> : <FiEye size={16} />}
              </button>
            </div>

            {error && <div className="text-red-400 text-sm text-center">{error}</div>}

            <button className="dialog-btn w-full" onClick={handleUnlock}>
              {t('TEXT_UNLOCK')}
            </button>

            {failedAttempts >= MAX_ATTEMPTS ? (
              <button
                className="text-xs text-yellow-400 hover:text-yellow-300 underline"
                onClick={() => setConfirmReset(true)}
              >
                {t('LOCK_RESET_TO_FS')}
              </button>
            ) : (
              <div className="text-xs opacity-40 text-center">
                {t('LOCK_FORGOT_PASSPHRASE')}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-sm text-center text-yellow-400">
              {t('LOCK_CONFIRM_RESET_MSG')}<br />
              {t('LOCK_CONFIRM_RESET_DB')}<br />
              <strong>{t('LOCK_CONFIRM_ARE_YOU_SURE')}</strong>
            </div>
            <div className="flex gap-3 w-full">
              <button className="dialog-btn flex-1" style={{ background: 'var(--danger-color, #e53e3e)' }} onClick={handleResetToFs}>
                {t('LOCK_YES_RESET')}
              </button>
              <button className="dialog-btn flex-1" onClick={() => setConfirmReset(false)}>
                {t('TEXT_CANCEL')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
