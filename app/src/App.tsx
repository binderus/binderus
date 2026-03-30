import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ToastContainer } from 'react-toastify';
import { toastError } from './app/components/toaster/toaster';

import AppContainer from './app/components/app-container/app-container';
import { useAppContext } from './app/hooks/use-app-context';
// import MainPage from './app/pages/main-page';
import TestPage from './app/pages/test-page';
import { BUILD_EXPIRED_DATE_STR, DEFAULT_LANG, DEFAULT_THEME } from './app/utils/constants';
import { initApp, getStartupError, getLockStatus, resetToFilesystem, quitApp, readVaultSettings, writeVaultSettings, getVaultPath } from './app/utils/tauri-utils';
import { isDarkTheme } from './app/utils/theme-registry';
import { debounce, getUserLocale, initI18n, isWeb, matchSupportedLocale, t } from './app/utils/base-utils';
import LockScreenOverlay from './app/components/lock-screen/lock-screen-overlay';
import { useAutoLock } from './app/hooks/use-auto-lock';
import { FiAlertTriangle } from 'react-icons/fi';

function App() {
  const [page, setPage] = useState('/');
  const [i18nVersion, setI18nVersion] = useState(0);
  const [dbMissing, setDbMissing] = useState(false);
  const [initDone, setInitDone] = useState(false);
  const {
    setDataDir,
    setSettingJson,
    setFavourites,
    setRecentList,
    setTheme,
    setSettingEmail,
    setEditorFont,
    theme,
    lang,
    setLang,
    isLocked,
    setIsLocked,
    setStorageBackend,
    setEncryptionEnabled,
    setAutoLockTimeout,
    setAutoLockOnMinimize,
    setEnterMode,
    setSidebarView
  } = useAppContext();

  useAutoLock();

  const checkExpiredBuild = debounce(() => {
    if (BUILD_EXPIRED_DATE_STR) {
      const expiredDate = new Date(BUILD_EXPIRED_DATE_STR); // a future date when this build will expire
      const isExpired = new Date() > expiredDate;
      if (isExpired) {
        alert(t('APP_EXPIRED'));
      }
    }
  }, 100);

  const init = async () => {
    if (isWeb) {
      // Dev/web mode: skip Tauri init, use defaults
      initI18n(getUserLocale() || DEFAULT_LANG);
      setTheme(DEFAULT_THEME);
      setDataDir('Binderus');
      setLang(DEFAULT_LANG);
      setInitDone(true);
      return;
    }

    // Parallelize independent startup IPC calls — initApp (FS ops), getStartupError
    // and getLockStatus (Rust backend queries) don't depend on each other.
    const [settingJson, startupErr, lockStatus] = await Promise.all([
      initApp(),
      getStartupError(),
      getLockStatus()
    ]);

    // Normalize stored lang (e.g. legacy 'ja-JP' → 'ja'), or auto-detect from OS.
    const rawLang = settingJson?.lang;
    const currentLang = (rawLang ? matchSupportedLocale(rawLang) : null) || matchSupportedLocale(getUserLocale());

    setDataDir(settingJson._vaultPath || '');
    setFavourites(settingJson.favourites ?? []);
    setRecentList(settingJson.recent ?? []);

    setTheme(settingJson?.theme ?? DEFAULT_THEME);
    setEditorFont(settingJson?.editor?.font ?? '');
    setLang(currentLang);
    setSettingEmail(settingJson?.settingEmail ?? '');

    if (startupErr === 'db_file_missing') {
      setDbMissing(true);
    } else if (startupErr) {
      toastError(`${t('MSG_DB_LOAD_FAILED')}\n${startupErr}`);
      setStorageBackend('filesystem');
    } else {
      setStorageBackend(settingJson?.storageBackend ?? 'filesystem');
    }
    setEncryptionEnabled(settingJson?.encryptionEnabled ?? false);
    setAutoLockTimeout(settingJson?.autoLockTimeout ?? 15);
    setAutoLockOnMinimize(settingJson?.autoLockOnMinimize ?? false);
    setEnterMode(settingJson?.enterMode ?? 'normal');
    setSidebarView('tree');

    if (lockStatus) setIsLocked(lockStatus.is_locked);
    // Only delay rendering AppContainer when DB is locked (prevent file list flash)
    if (!lockStatus?.is_locked) setInitDone(true);

    // Recovery: detect settings file corruption caused by createDataFile using invoke('is_file')
    // through the libsql provider (which checks the DB, not disk) — causing the settings file to
    // be overwritten with DEFAULT_SETTING (storageBackend: 'filesystem', encryptionEnabled: false)
    // on every startup in DB mode. Detection: Rust reports is_locked=true but settings say
    // encryptionEnabled=false, which is impossible in a healthy state.
    if (!startupErr && lockStatus?.is_locked && !settingJson?.encryptionEnabled) {
      setStorageBackend('libsql');
      setEncryptionEnabled(true);
      const fixedJson: any = await readVaultSettings(getVaultPath());
      fixedJson.storageBackend = 'libsql';
      fixedJson.encryptionEnabled = true;
      await writeVaultSettings(fixedJson);
    }

    setSettingJson(settingJson);
    setInitDone(true);
    checkExpiredBuild();
  };
  const initDebounced = debounce(
    () => init().catch((e) => console.error('App init failed:', e)),
    100
  );

  useEffect(() => {
    initDebounced();
  }, []);

  useEffect(() => {
    if (lang) {
      initI18n(lang);
      setI18nVersion((n) => n + 1);
    }
  }, [lang]);

  const handleResetToDisk = async () => {
    await resetToFilesystem();
    await quitApp();
  };

  return (
    <div>
      {page === '/' && (initDone && !isLocked) && <AppContainer onNav={(path) => setPage(path)} i18nVersion={i18nVersion} />}
      {page === '/test' && <TestPage onNav={(path) => setPage(path)} />}
      <ToastContainer theme={isDarkTheme(theme) ? 'dark' : 'light'} position="bottom-right" />
      {isLocked && !dbMissing && <LockScreenOverlay />}
      {dbMissing && createPortal(
        <div className="flex items-center justify-center bg-black/80" style={{ position: 'fixed', inset: 0, zIndex: 10000 }}>
          <div className="flex flex-col items-center gap-4 p-8 rounded-2xl shadow-2xl" style={{ background: 'var(--bg-primary)', minWidth: 340, maxWidth: 420, width: '90%' }}>
            <FiAlertTriangle size={40} className="text-yellow-400" />
            <div className="text-xl font-semibold">Database Not Found</div>
            <div className="text-sm opacity-70 text-center leading-relaxed">
              Your storage is set to Database mode, but the database file could not be found.
              It may have been moved or deleted.
            </div>
            <div className="flex flex-col gap-2 w-full mt-2">
              <button className="dialog-btn w-full" onClick={handleResetToDisk}>
                Reset to Disk &amp; Restart
              </button>
              <button className="dialog-btn w-full opacity-70" onClick={quitApp}>
                Close App
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default App;
