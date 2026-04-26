import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ToastContainer } from 'react-toastify';
import { toastError } from './app/components/toaster/toaster';

import AppContainer from './app/components/app-container/app-container';
import { useAppContext } from './app/hooks/use-app-context';
// import MainPage from './app/pages/main-page';
import TestPage from './app/pages/test-page';
import { DEFAULT_LANG, DEFAULT_THEME } from './app/utils/constants';
import { initApp, getStartupError, getLockStatus, resetToFilesystem, quitApp, readVaultSettings, writeVaultSettings, getVaultPath, flushAllPendingWrites, readGlobalSettings, writeGlobalSettings } from './app/utils/tauri-utils';
import { isDarkTheme, registerThemes } from './app/utils/theme-registry';
import { discoverCustomThemes, applyAccentOverride, applyCodeThemeOverride, extractPrismColors } from './app/utils/theme-loader';
import { getThemeSourceCSS } from './app/utils/theme-registry';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { debounce, getUserLocale, initI18n, isWeb, matchSupportedLocale, t } from './app/utils/base-utils';
import LockScreenOverlay from './app/components/lock-screen/lock-screen-overlay';
import { useAutoLock } from './app/hooks/use-auto-lock';
import { scheduleStartupVersionPing } from './app/hooks/use-version-check';
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
    setClientUuid,
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

  const init = async () => {
    if (isWeb) {
      // Dev/web mode: skip Tauri init, use defaults
      await initI18n(getUserLocale() || DEFAULT_LANG);
      setTheme(DEFAULT_THEME);
      setDataDir('Binderus');
      setLang(DEFAULT_LANG);
      setInitDone(true);
      return;
    }

    // Parallelize independent startup IPC calls — initApp (FS ops), getStartupError,
    // getLockStatus, and readGlobalSettings (client UUID lookup) don't depend on each
    // other. Rolling readGlobalSettings into the same Promise.all shaves ~one IPC
    // round-trip off cold boot (~50-150 ms depending on backend).
    const [settingJson, startupErr, lockStatus, globalJson] = await Promise.all([
      initApp(),
      getStartupError(),
      getLockStatus(),
      readGlobalSettings()
    ]);

    // Normalize stored lang (e.g. legacy 'ja-JP' → 'ja'), or auto-detect from OS.
    const rawLang = settingJson?.lang;
    const currentLang = (rawLang ? matchSupportedLocale(rawLang) : null) || matchSupportedLocale(getUserLocale());

    setDataDir(settingJson._vaultPath || '');
    setFavourites(settingJson.favourites ?? []);
    setRecentList(settingJson.recent ?? []);

    // Discover user-installed custom themes from $APPDATA/themes/ and merge into the
    // registry BEFORE setTheme() so the picker has the full list on first render and
    // a saved custom-theme id resolves correctly.
    try {
      const customThemes = await discoverCustomThemes();
      if (customThemes.length > 0) registerThemes(customThemes);
    } catch {
      // Discovery is best-effort; failures must not block startup.
    }

    setTheme(settingJson?.theme ?? DEFAULT_THEME);

    // Re-apply any persisted accent-color override so it survives across launches.
    const ov = settingJson?.accentOverride;
    if (ov && typeof ov.h === 'number' && typeof ov.s === 'number' && typeof ov.l === 'number') {
      applyAccentOverride(ov);
    }

    // Re-apply any persisted code-theme override (Phase F2).
    const codeThemeId: string | undefined = settingJson?.codeTheme;
    if (codeThemeId) {
      const css = getThemeSourceCSS(codeThemeId);
      if (css) {
        const colors = extractPrismColors(css);
        if (colors) applyCodeThemeOverride(colors);
      }
    }
    setEditorFont(settingJson?.editor?.font ?? '');
    setLang(currentLang);
    setSettingEmail(settingJson?.settingEmail ?? '');

    // Generate and persist a client UUID in global config (once per installation, across all vaults).
    // Migrate from per-vault clientUuid if present (legacy), then clear it from vault settings.
    const globalConfig: any = globalJson ?? {};
    let uuid = globalConfig?.clientUuid ?? '';
    if (!uuid) {
      uuid = settingJson?.clientUuid || crypto.randomUUID();
      globalConfig.clientUuid = uuid;
      await writeGlobalSettings(globalConfig);
    }
    setClientUuid(uuid);

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
  };
  // HMR coalesce: in dev, init() can fire multiple times on fast-refresh; 100ms debounce
  // dedupes. In production there's only one mount ever, so the debounce just adds 100ms
  // of dead time to cold boot. Gate on import.meta.env.DEV.
  const initDebounced = import.meta.env.DEV
    ? debounce(() => init().catch((e) => console.error('App init failed:', e)), 100)
    : () => { init().catch((e) => console.error('App init failed:', e)); };

  // Remove zero-JS boot splash once React has mounted the real tree.
  // Runs once on mount; splash is an absolutely-positioned overlay so this is a no-op
  // for layout, just fades it out of the DOM.
  useEffect(() => {
    const splash = document.getElementById('boot-splash');
    if (splash) splash.remove();
  }, []);

  useEffect(() => {
    initDebounced();
    scheduleStartupVersionPing();

    // Graceful shutdown: flush pending debounced writes before quit.
    // Handles both window close (red X) and Cmd+Q (custom menu event).
    if (!isWeb) {
      const gracefulShutdown = async () => {
        try {
          await flushAllPendingWrites();
        } catch (e) {
          console.error('Flush on quit failed:', e);
        }
        await quitApp(); // Rust side checkpoints WAL then exits
      };

      const unlisteners: (() => void)[] = [];

      // Red X / window close button
      getCurrentWindow().onCloseRequested(async (event) => {
        event.preventDefault();
        await gracefulShutdown();
      }).then((fn) => unlisteners.push(fn));

      // Cmd+Q / menu Quit (macOS) — emitted by Rust menu handler
      listen('graceful-quit', () => gracefulShutdown()).then((fn) => unlisteners.push(fn));

      return () => unlisteners.forEach((fn) => fn());
    }
  }, []);

  useEffect(() => {
    if (lang) {
      initI18n(lang).then(() => setI18nVersion((n) => n + 1));
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
