import { Dialog, DialogPanel, DialogTitle, Transition } from '@headlessui/react';
import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { open as dialogOpen, ask } from '@tauri-apps/plugin-dialog';
import { getDocumentDir, getStorageInfo, migrateToDb, quitApp, StorageInfo, readGlobalSettings, writeGlobalSettings, readVaultSettings, writeVaultSettings, getVaultPath, setVaultPath, initVault, createExampleNote } from '../../utils/tauri-utils';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { Fragment, useEffect, useState } from 'react';
import { FiExternalLink, FiChevronDown, FiChevronRight } from 'react-icons/fi';
// import { PuffLoader } from 'react-spinners';
import { useAppContext } from '../../hooks/use-app-context';
import { Theme } from '../../types';
import { getAllThemes } from '../../utils/theme-registry';
import {
  fontNames,
  getOS,
  getUserLocale,
  isWeb,
  locales,
  OS,
  t,
  validateEmail
} from '../../utils/base-utils';
import { VERSION } from '../../utils/constants';
import { SHORTCUTS } from '../../utils/keyboard-shortcuts';
import { getPath, selectDir, checkDbPassphrase } from '../../utils/tauri-utils';
import { toastError, toastInfo, toastSuccess } from '../toaster/toaster';

// Panel height removed — using min-height via CSS class .dialog-section

import { useAppStore } from '../../hooks/use-app-store';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

enum Tab {
  General = 'General',
  Editor = 'Editor',
  Shortcuts = 'Shortcuts',
  Storage = 'Storage'
}

export default function SettingModal({ isOpen, onClose }: Props) {
  // const [isLoading, setIsLoading] = useState(true);
  const {
    dataDir,
    setDataDir,
    theme,
    setTheme,
    settingEmail,
    setSettingEmail,
    lang,
    setLang,
    editorFont,
    setEditorFont,
    storageBackend,
    setStorageBackend,
    setEncryptionEnabled,
    autoLockTimeout,
    setAutoLockTimeout,
    autoLockOnMinimize,
    setAutoLockOnMinimize,
    enterMode,
    setEnterMode,
    setSidebarView,
    setFavourites,
    setRecentList,
    setFolderStack,
  } = useAppContext();
  const closeAllTabs = useAppStore((s) => s.closeAllTabs);
  const [docDir, setDocDir] = useState(dataDir);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  
  // Track the on-disk email to know if the input has been changed
  const [savedEmail, setSavedEmail] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);

  const [tab, setTab] = useState(Tab.General);
  const [passphrase, setPassphrase] = useState('');
  const [migrationState, setMigrationState] = useState<'idle' | 'db_exists' | 'enter_passphrase' | 'confirm' | 'migrating' | 'done' | 'restart_required'>('idle');
  const [shaking, setShaking] = useState(false);
  // Local radio selection — only applied on Save
  const [selectedBackend, setSelectedBackend] = useState(storageBackend);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isExportingDb, setIsExportingDb] = useState(false);

  // Use storageBackend from context (the configured backend from settings file), not
  // storageInfo?.name (the active provider), because when the DB is locked Rust uses
  // FsProvider as a placeholder and storageInfo would incorrectly report 'filesystem'.
  const currentBackend = storageBackend;
  const isAlreadyDb = currentBackend === 'libsql';
  const isSwitchingToDb = selectedBackend === 'libsql' && !isAlreadyDb;

  useEffect(() => {
    if (isWeb) return;
    const init = async () => {
      const path = await getDocumentDir();
      setDocDir(path);
      
      const json: any = await readGlobalSettings();
      if (json?.settingEmail) {
        setSavedEmail(json.settingEmail);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (isWeb || tab !== Tab.Storage) return;
    getStorageInfo().then(setStorageInfo);
    setSelectedBackend(storageBackend);
    setPassphrase('');
    setErrorMsg('');
    setMigrationState('idle');
  }, [tab]);


  const changeDirClicked = async () => {
    try {
      toastInfo(`${t('TEXT_NOTE')}: ${t('SETTING_ONLY_DOCUMENTS')}`);

      const newDir = await selectDir(docDir || undefined);
      if (!newDir) {
        return;
      }
      const documentPath = await getDocumentDir();
      if (!newDir?.includes(documentPath)) {
        toastError(t('SETTING_ONLY_DOCUMENTS'));
        return;
      }
      if (newDir) {
        await initVault(newDir);
        setVaultPath(newDir);
        setDataDir(newDir);
        await createExampleNote();

        // Update global settings
        const globalJson: any = await readGlobalSettings();
        globalJson.lastOpenedVault = newDir;
        await writeGlobalSettings(globalJson);

        // Reload vault settings for the new directory
        const vault: any = await readVaultSettings(newDir);
        setStorageBackend(vault.storageBackend ?? 'filesystem');
        setEncryptionEnabled(vault.encryptionEnabled ?? false);
        setAutoLockTimeout(vault.autoLockTimeout ?? 15);
        setAutoLockOnMinimize(vault.autoLockOnMinimize ?? false);
        setEnterMode(vault.enterMode ?? 'normal');
        setSidebarView('tree');
        setFavourites(vault.favourites ?? []);
        setRecentList(vault.recent ?? []);

        // Clear stale navigation state from old directory
        setFolderStack([]);
        closeAllTabs();

        toastSuccess(`${t('SETTING_DATA_DIR')}: ${newDir}`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const themeChanged = async (e: any) => {
    const themeName = e?.target?.value ?? '';
    setTheme(themeName);

    const json: any = await readGlobalSettings();
    json.theme = themeName;
    await writeGlobalSettings(json);
  };

  const fontChanged = async (e: any) => {
    const fontName = e?.target?.value ?? '';
    setEditorFont(fontName);
    const json: any = await readGlobalSettings();
    json.editor = { ...(json.editor ?? {}), font: fontName };
    await writeGlobalSettings(json);
  };

  const langChanged = (e: any) => {
    const lang = e?.target?.value ?? '';
    setLang(lang);
  };

  const settingEmailChanged = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('');
    setSuccessMsg('');
    setSettingEmail(e.target.value);
  };

  const requestProLicense = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    const email = settingEmail.trim();
    if (!email || validateEmail(email) === false) {
      setErrorMsg(t('SETTING_INVALID_EMAIL', { email }));
      return;
    }

    setIsRequesting(true);
    try {
      // Send to Slack webhook via Rust backend
      await invoke('send_pro_license_request', { email });
      
      // Save it locally so we don't keep asking
      const json: any = await readGlobalSettings();
      json.settingEmail = email;
      await writeGlobalSettings(json);
      setSavedEmail(email);
      setSuccessMsg(t('MSG_REQUEST_SENT'));
      toastSuccess(t('MSG_REQUEST_SENT'));
      
    } catch (err: any) {
      console.error('Failed to send PRO license request webhook:', err);
      setErrorMsg(err.toString());
      toastError(`${t('MSG_REQUEST_FAILED')}: ${err.toString()}`);
    } finally {
      setIsRequesting(false);
    }
  };

  const okClicked = async () => {
    setErrorMsg('');
    const email = settingEmail.trim();
    if (email && validateEmail(email) === false) {
      setErrorMsg(t('SETTING_INVALID_EMAIL', { email }));
      return;
    }
    const json: any = await readGlobalSettings();
    json.settingEmail = settingEmail;
    await writeGlobalSettings(json);

    onClose();
  };

  const backendRadioChanged = (newBackend: 'filesystem' | 'libsql') => {
    setSelectedBackend(newBackend);
    if (newBackend !== 'libsql') setPassphrase('');
    setErrorMsg('');
  };

  const startMigration = async () => {
    setMigrationState('migrating');
    try {
      await migrateToDb(passphrase || undefined, true);
      const json: any = await readVaultSettings();
      json.storageBackend = 'libsql';
      if (passphrase) json.encryptionEnabled = true;
      await writeVaultSettings(json);
      setMigrationState('done');
    } catch (err) {
      console.error(err);
      toastError(`${t('MSG_MIGRATION_FAILED')}: ${err}`);
      setMigrationState('idle');
    }
  };

  const tryUnlockExistingDb = async () => {
    setErrorMsg('');
    const dbCheck = await checkDbPassphrase(passphrase || undefined);
    if (dbCheck === 'unlocked') {
      const json: any = await readVaultSettings();
      json.storageBackend = 'libsql';
      if (passphrase) json.encryptionEnabled = true;
      await writeVaultSettings(json);
      setMigrationState('restart_required');
    } else {
      setErrorMsg(t('MSG_INCORRECT_PASSPHRASE'));
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      setPassphrase('');
    }
  };

  const exportDbToDir = async () => {
    try {
      const targetDir = await dialogOpen({
        title: 'Select export directory',
        directory: true,
        multiple: false,
      });
      if (!targetDir) return;
      const confirmed = await ask(
        `This will export all files and directories to:\n${targetDir}\n\nExisting files will be overwritten. Continue?`,
        { title: 'Confirm Export', kind: 'warning' }
      );
      if (!confirmed) return;
      setIsExportingDb(true);
      const stats: { files_exported: number; dirs_exported: number } = await invoke('export_db_to_fs', { targetDir: targetDir });
      toastSuccess(t('MSG_EXPORT_SUCCESS', { files: stats.files_exported, dirs: stats.dirs_exported }));
    } catch (err: any) {
      console.error('DB export failed:', err);
      toastError(`${t('MSG_EXPORT_FAILED')}: ${err}`);
    } finally {
      setIsExportingDb(false);
    }
  };

  const storageOkClicked = async () => {
    if (isSwitchingToDb) {
      if (passphrase && passphrase.length < 8) {
        setErrorMsg(t('MSG_PASSPHRASE_MIN_LENGTH'));
        return;
      }
      const probe = await checkDbPassphrase();
      if (probe === 'db_exists') {
        setMigrationState('db_exists');
        return;
      }
      setMigrationState('confirm');
      return;
    }
    const json: any = await readVaultSettings();
    json.storageBackend = selectedBackend;
    await writeVaultSettings(json);
    if (selectedBackend !== currentBackend) {
      setStorageBackend(selectedBackend);
      setMigrationState('restart_required');
      return;
    }
    onClose();
  };

  const currentLang = lang || getUserLocale();
  const cmdKeyName = getOS() === OS.Mac ? 'Cmd' : 'Ctrl';

  return (
    <>
      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="fixed inset-0 z-10 overflow-y-auto" onClose={onClose}>
          <div className="min-h-screen px-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 z-0 bg-black/30" />
            </Transition.Child>

            {/* This element is to trick the browser into centering the modal contents. */}
            <span className="inline-block h-screen align-middle" aria-hidden="true">
              &#8203;
            </span>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel
                className="dialog-panel relative z-10 inline-block w-full max-w-md p-6 my-8 text-left align-middle transition-all transform shadow-xl rounded-2xl"
                style={{ maxWidth: '40vw' }}
              >
                <DialogTitle
                  as="h3"
                  className="dialog-title flex items-center justify-between text-lg font-medium leading-6"
                >
                  <div>{t('APP_MAIN_SETTINGS')}</div>
                </DialogTitle>

                <div className="dialog-body">
                  <nav className="dialog-tabs">
                    <button
                      className={`dialog-tab ${tab === Tab.General ? 'dialog-tab-active' : ''}`}
                      onClick={() => setTab(Tab.General)}
                    >
                      {t('SETTING_TAB_GENERAL')}
                    </button>
                    <button
                      className={`dialog-tab ${tab === Tab.Editor ? 'dialog-tab-active' : ''}`}
                      onClick={() => setTab(Tab.Editor)}
                    >
                      {t('SETTING_TAB_EDITOR')}
                    </button>
                    <button
                      className={`dialog-tab ${tab === Tab.Shortcuts ? 'dialog-tab-active' : ''}`}
                      onClick={() => setTab(Tab.Shortcuts)}
                    >
                      {t('SETTING_TAB_SHORTCUTS')}
                    </button>
                    <button
                      className={`dialog-tab ${tab === Tab.Storage ? 'dialog-tab-active' : ''}`}
                      onClick={() => setTab(Tab.Storage)}
                    >
                      {t('SETTING_TAB_STORAGE')}
                    </button>
                  </nav>

                  {tab === Tab.General && (
                    <section className="dialog-section">
                      <div className="dialog-field">
                        <div className="dialog-label">{t('SETTING_LANG')}</div>
                        <select className="dialog-select" style={{ width: '33%' }} value={currentLang} onChange={langChanged}>
                          {locales.map((locale) => (
                            <option key={locale.id} value={locale.id}>
                              {locale.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="dialog-field">
                        <div className="dialog-label">
                          {t('SETTING_DATA_DIR')}{' '}
                          <span className="dialog-link ml-1" onClick={changeDirClicked}>
                            {t('SETTING_CHANGE_DIR')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            className="dialog-input"
                            value={dataDir}
                            readOnly
                          />
                          <span
                            className="dialog-link flex-shrink-0"
                            onClick={() => revealItemInDir(dataDir)}
                          >
                            <FiExternalLink size={15} />
                          </span>
                        </div>
                      </div>

                      <div className="dialog-divider" />

                      <div>
                        <div className="dialog-version">
                          {t('TEXT_CURRENT_VERSION')}: {VERSION} {t('TEXT_FREE_CAPS')} - {t('TEXT_REQUEST')}{' '}
                          <b>{t('TEXT_PRO_CAPS')}</b> {t('TEXT_LICENSE_FOR_FREE')}:
                        </div>
                        <div className="flex gap-2 items-center mt-2">
                          <input
                            className="dialog-input flex-1"
                            placeholder={t('SETTING_EMAIL_PLACEHOLDER')}
                            value={settingEmail}
                            onChange={settingEmailChanged}
                            onKeyDown={(e) => { if (e.key === 'Enter') requestProLicense(); }}
                          />
                          {settingEmail.trim() !== '' && settingEmail.trim() !== savedEmail && (
                            <button 
                              className={`dialog-btn whitespace-nowrap ${isRequesting ? 'opacity-50 cursor-not-allowed' : ''}`}
                              onClick={requestProLicense}
                              disabled={isRequesting}
                            >
                              {isRequesting ? t('TEXT_SENDING') : t('TEXT_REQUEST')}
                            </button>
                          )}
                        </div>
                        {errorMsg && <div className="dialog-error">{errorMsg}</div>}
                        {successMsg && <div className="text-sm font-medium mt-1" style={{ color: 'var(--app-success-color, #a3be8c)' }}>{successMsg}</div>}
                      </div>

                      <div className="dialog-field">
                        <span>{t('TEXT_EULA_TITLE')}</span>{' '}
                        <a
                          href="#"
                          onClick={(e) => { e.preventDefault(); shellOpen('https://github.com/binderus/binderus/blob/main/docs/end-user-license-agreement.md'); }}
                          className="dialog-link ml-1"
                          tabIndex={-1}
                        >
                          {t('TEXT_OPEN')}
                        </a>
                      </div>
                    </section>
                  )}

                  {tab === Tab.Editor && (
                    <section className="dialog-section">
                      <div className="dialog-field">
                        <div className="dialog-label">{t('SETTING_MAIN_FONT')}</div>
                        <select className="dialog-select" style={{ width: '33%' }} value={editorFont} onChange={fontChanged}>
                          {fontNames.map((fontName) => (
                            <option key={fontName} value={fontName}>
                              {fontName}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="dialog-field">
                        <div className="dialog-label">{t('TEXT_THEME')}</div>
                        <select className="dialog-select" style={{ width: '50%' }} value={theme} onChange={themeChanged}>
                          <optgroup label={t('TEXT_THEME_DARK')}>
                            {getAllThemes().filter((t) => t.variant === 'dark').map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </optgroup>
                          <optgroup label={t('TEXT_THEME_LIGHT')}>
                            {getAllThemes().filter((t) => t.variant === 'light').map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </optgroup>
                        </select>
                      </div>

                      <div className="dialog-field">
                        <div className="dialog-label">{t('SETTING_ENTER_KEY_BEHAVIOR')}</div>
                        <div className="dialog-radio-group">
                          <label>
                            <input
                              type="radio"
                              name="enterMode"
                              value="normal"
                              checked={enterMode === 'normal'}
                              onChange={async () => {
                                setEnterMode('normal');
                                const json: any = await readVaultSettings();
                                json.enterMode = 'normal';
                                await writeVaultSettings(json);
                              }}
                            />
                            <span><strong>{t('SETTING_ENTER_NORMAL')}</strong> — {t('SETTING_ENTER_NORMAL_DESC')}</span>
                          </label>
                          <label>
                            <input
                              type="radio"
                              name="enterMode"
                              value="paragraph"
                              checked={enterMode === 'paragraph'}
                              onChange={async () => {
                                setEnterMode('paragraph');
                                const json: any = await readVaultSettings();
                                json.enterMode = 'paragraph';
                                await writeVaultSettings(json);
                              }}
                            />
                            <span><strong>{t('SETTING_ENTER_PARAGRAPH')}</strong> — {t('SETTING_ENTER_PARAGRAPH_DESC')}</span>
                          </label>
                        </div>
                      </div>

                    </section>
                  )}

                  {tab === Tab.Storage && (
                    <section className="dialog-section">
                      {migrationState === 'idle' && (
                        <>
                          <div className="dialog-field">
                            <div className="dialog-label">{t('SETTING_TAB_STORAGE')}</div>
                            <div className="dialog-radio-group">
                              <label>
                                <input
                                  type="radio"
                                  name="storageBackend"
                                  value="filesystem"
                                  checked={selectedBackend === 'filesystem'}
                                  onChange={() => backendRadioChanged('filesystem')}
                                />
                                <span><strong>{t('STORAGE_DISK')}</strong> — {t('STORAGE_DISK_DESC')}</span>
                              </label>
                              <label>
                                <input
                                  type="radio"
                                  name="storageBackend"
                                  value="libsql"
                                  checked={selectedBackend === 'libsql'}
                                  onChange={() => backendRadioChanged('libsql')}
                                />
                                <span><strong>{t('STORAGE_SECURED_DB')}</strong> — {t('STORAGE_SECURED_DB_DESC')}</span>
                              </label>
                            </div>
                          </div>

                          {isSwitchingToDb && (
                            <div className="dialog-field">
                              <div className="dialog-label">{t('STORAGE_PASSPHRASE')} <span className="opacity-50">{t('STORAGE_PASSPHRASE_OPTIONAL')}</span></div>
                              <input
                                type="password"
                                className="dialog-input"
                                placeholder={t('STORAGE_PASSPHRASE_PLACEHOLDER')}
                                value={passphrase}
                                onChange={(e) => { setPassphrase(e.target.value); setErrorMsg(''); }}
                              />
                              {errorMsg && <div className="dialog-error">{errorMsg}</div>}
                              <p className="text-xs opacity-50 mt-1">{t('STORAGE_PASSPHRASE_NOTE')}</p>
                            </div>
                          )}

                          {isAlreadyDb && selectedBackend === 'libsql' && (
                            <div className="dialog-field">
                              <button
                                type="button"
                                className="flex items-center gap-1 text-sm opacity-70 hover:opacity-100"
                                onClick={() => setAdvancedOpen((v) => !v)}
                              >
                                {advancedOpen ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
                                <span>{t('STORAGE_ADVANCED')}</span>
                              </button>

                              {advancedOpen && (
                                <div className="flex flex-col gap-3 mt-2 pl-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm">{t('STORAGE_AUTO_LOCK')}</span>
                                    <select
                                      className="dialog-select"
                                      style={{ width: 'auto' }}
                                      value={autoLockTimeout}
                                      onChange={async (e) => {
                                        const val = Number(e.target.value);
                                        setAutoLockTimeout(val);
                                        const json: any = await readVaultSettings();
                                        json.autoLockTimeout = val;
                                        await writeVaultSettings(json);
                                      }}
                                    >
                                      <option value={0}>{t('STORAGE_AUTO_LOCK_OFF')}</option>
                                      <option value={1}>{t('STORAGE_AUTO_LOCK_1MIN')}</option>
                                      <option value={5}>{t('STORAGE_AUTO_LOCK_5MIN')}</option>
                                      <option value={15}>{t('STORAGE_AUTO_LOCK_15MIN')}</option>
                                      <option value={30}>{t('STORAGE_AUTO_LOCK_30MIN')}</option>
                                      <option value={60}>{t('STORAGE_AUTO_LOCK_1HOUR')}</option>
                                    </select>
                                  </div>

                                  <label className="flex items-center justify-between cursor-pointer">
                                    <span className="text-sm">{t('STORAGE_LOCK_MINIMIZE')}</span>
                                    <input
                                      type="checkbox"
                                      checked={autoLockOnMinimize}
                                      onChange={async (e) => {
                                        const val = e.target.checked;
                                        setAutoLockOnMinimize(val);
                                        const json: any = await readVaultSettings();
                                        json.autoLockOnMinimize = val;
                                        await writeVaultSettings(json);
                                      }}
                                    />
                                  </label>

                                  <div className="flex items-center justify-between">
                                    <span className="text-sm">{t('STORAGE_EXPORT_ALL')}</span>
                                    <button
                                      className={`dialog-btn text-xs ${isExportingDb ? 'opacity-50 cursor-not-allowed' : ''}`}
                                      onClick={exportDbToDir}
                                      disabled={isExportingDb}
                                    >
                                      {isExportingDb ? t('TEXT_EXPORTING') : t('STORAGE_EXPORT_TO_DIR')}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {isAlreadyDb && (
                            <div className="dialog-field">
                              <p className="text-xs opacity-50">DB: {getVaultPath() + '/.binderus/binderus.db'}</p>
                            </div>
                          )}

                          {errorMsg && !isSwitchingToDb && <div className="dialog-error">{errorMsg}</div>}
                        </>
                      )}

                      {migrationState === 'db_exists' && (
                        <div className="flex flex-col gap-4 py-2">
                          <p className="text-sm font-medium">{t('STORAGE_DB_FOUND')}</p>
                          <p className="text-sm opacity-70">{t('STORAGE_DB_FOUND_DESC')}</p>
                          <div className="flex gap-2">
                            <button className="dialog-btn" onClick={() => { setPassphrase(''); setErrorMsg(''); setMigrationState('enter_passphrase'); }}>
                              {t('STORAGE_USE_EXISTING_DB')}
                            </button>
                            <button className="dialog-btn" onClick={() => setMigrationState('confirm')}>
                              {t('STORAGE_START_FRESH')}
                            </button>
                            <button className="dialog-btn" onClick={() => setMigrationState('idle')}>{t('TEXT_CANCEL')}</button>
                          </div>
                        </div>
                      )}

                      {migrationState === 'enter_passphrase' && (
                        <div className="flex flex-col gap-4 py-2">
                          <p className="text-sm font-medium">{t('STORAGE_ENTER_PASSPHRASE_TITLE')}</p>
                          <p className="text-xs opacity-50">{t('STORAGE_LEAVE_EMPTY_DB')}</p>
                          <div className={shaking ? 'shake' : ''}>
                            <input
                              type="password"
                              className="dialog-input w-full"
                              placeholder={t('STORAGE_PASSPHRASE_OR_EMPTY')}
                              value={passphrase}
                              onChange={(e) => { setPassphrase(e.target.value); setErrorMsg(''); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') tryUnlockExistingDb(); }}
                              autoFocus
                            />
                          </div>
                          {errorMsg && <div className="dialog-error">{errorMsg}</div>}
                          <div className="flex gap-2">
                            <button className="dialog-btn" onClick={tryUnlockExistingDb}>{t('TEXT_UNLOCK')}</button>
                            <button className="dialog-btn" onClick={() => setMigrationState('db_exists')}>{t('TEXT_BACK')}</button>
                          </div>
                          <button
                            className="text-xs opacity-50 hover:opacity-80 underline text-left"
                            onClick={() => { setPassphrase(''); setMigrationState('confirm'); }}
                          >
                            {t('STORAGE_FORGOT_PASSPHRASE')}
                          </button>
                        </div>
                      )}

                      {migrationState === 'confirm' && (
                        <div className="flex flex-col gap-4 py-2">
                          <p className="text-sm">{t('STORAGE_MIGRATE_CONFIRM')}</p>
                          {passphrase && <p className="text-xs opacity-50">{t('STORAGE_MIGRATE_ENCRYPTED_NOTE')}</p>}
                          <div className="flex gap-2">
                            <button className="dialog-btn" onClick={startMigration}>{t('TEXT_CONFIRM')}</button>
                            <button className="dialog-btn" onClick={() => setMigrationState('idle')}>{t('TEXT_CANCEL')}</button>
                          </div>
                        </div>
                      )}

                      {migrationState === 'migrating' && (
                        <div className="flex flex-col gap-3 py-2">
                          <p className="text-sm">{t('STORAGE_MIGRATING')}</p>
                          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--app-border-color, #444)' }}>
                            <div
                              className="h-full rounded-full"
                              style={{
                                background: 'var(--app-accent-color, #88c0d0)',
                                animation: 'indeterminate-bar 1.5s ease-in-out infinite',
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {migrationState === 'done' && (
                        <div className="flex flex-col gap-3 py-2">
                          <p className="text-sm">{t('STORAGE_MIGRATION_DONE')}</p>
                          <button className="dialog-btn" onClick={quitApp}>{t('TEXT_RESTART_APP')}</button>
                        </div>
                      )}

                      {migrationState === 'restart_required' && (
                        <div className="flex flex-col gap-3 py-2">
                          <p className="text-sm">{t('STORAGE_SETTING_SAVED')}</p>
                          <button className="dialog-btn" onClick={quitApp}>{t('TEXT_RESTART_APP')}</button>
                        </div>
                      )}
                    </section>
                  )}

                  {tab === Tab.Shortcuts && (
                    <section className="dialog-section" style={{ maxHeight: 400, overflowY: 'auto' }}>
                      <div className="dialog-field">
                        <div className="dialog-label" style={{ fontSize: '0.875rem' }}>{t('SETTING_SHORTCUTS_APP')}</div>
                        {SHORTCUTS.map((s) => (
                          <div className="dialog-shortcut-row" key={s.id}>
                            <span className="dialog-kbd">{cmdKeyName === 'Cmd' ? s.mac : s.win}</span>
                            <span>{t(s.labelKey)}</span>
                          </div>
                        ))}

                        <div className="dialog-label mt-4" style={{ fontSize: '0.875rem' }}>{t('SETTING_SHORTCUTS_EDITOR')}</div>
                        <div className="dialog-shortcut-row">
                          <span className="dialog-kbd">Shift Enter</span>
                          <span>{t('SHORTCUT_BREAK_LINE')}</span>
                        </div>
                        <div className="dialog-shortcut-row">
                          <span className="dialog-kbd">{cmdKeyName} [</span>
                          <span>{t('SHORTCUT_LIST_UP')}</span>
                        </div>
                        <div className="dialog-shortcut-row">
                          <span className="dialog-kbd">{cmdKeyName} ]</span>
                          <span>{t('SHORTCUT_LIST_DOWN')}</span>
                        </div>
                        <div className="dialog-shortcut-row">
                          <span className="dialog-kbd">{cmdKeyName} Alt 0-6</span>
                          <span>{t('SHORTCUT_HEADINGS')}</span>
                        </div>
                        <div className="dialog-shortcut-row">
                          <span className="dialog-kbd">{cmdKeyName} Alt C</span>
                          <span>{t('SHORTCUT_CODE_FENCE')}</span>
                        </div>
                      </div>
                    </section>
                  )}
                </div>

                <div className="mt-5">
                  {(tab !== Tab.Storage || migrationState === 'idle') && (
                    <button type="button" className="dialog-btn" onClick={tab === Tab.Storage ? storageOkClicked : okClicked}>
                      {tab === Tab.Storage ? t('TEXT_SAVE') : t('TEXT_OK')}
                    </button>
                  )}
                </div>
              </DialogPanel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}
