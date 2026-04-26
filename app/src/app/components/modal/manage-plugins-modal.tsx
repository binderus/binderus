/**
 * Description: Modal that lists all registered plugins with a runtime
 *   enable/disable toggle and an "Install from zip" button that lets
 *   the user drop a .zip file into the vault's plugin folder without
 *   touching Finder.
 *
 *   Install flow:
 *     1. open() from plugin-dialog filtered to .zip
 *     2. invoke Tauri `install_plugin_from_zip`, which validates the
 *        manifest and unpacks into <vault>/.binderus/plugins/<id>/
 *     3. call plugin-loader's `hotLoadUserPluginById` so the plugin
 *        activates without an app restart
 *     4. refresh the list via subscribePlugins / listPlugins
 *
 *   Runtime toggles still do NOT persist across app restarts —
 *   persistence will land with plugin settings later.
 *
 * Inputs: isOpen, onClose.
 * Outputs: rendered dialog listing plugins with enable/disable controls
 *   plus the install-from-zip action.
 */

import { Dialog, DialogPanel, DialogTitle, Transition } from '@headlessui/react';
import { Fragment, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';

import { t } from '../../utils/base-utils';
import { useAppStore } from '../../hooks/use-app-store';
import { getStorageInfo } from '../../utils/tauri-utils';
import { listPlugins, setPluginEnabled, subscribePlugins, unregisterPlugin, type PluginInfo } from '../../plugins';
import { hotLoadUserPluginById } from '../../plugins/plugin-loader';
import PluginGalleryModal from './plugin-gallery-modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// Shape returned by the Rust `install_plugin_from_zip` command. Kept
// local to the modal — if another surface ever needs to install
// plugins programmatically we'll lift this to a shared types module.
interface PluginInstallResult {
  id: string;
  name: string;
  version: string;
  installedPath: string;
}

// Discriminated banner state — lets the UI render success/error with a
// single <div> and avoids the "is it an error?" string heuristic.
type InstallStatus =
  | { kind: 'idle' }
  | { kind: 'installing' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export default function ManagePluginsModal({ isOpen, onClose }: Props) {
  const [plugins, setPlugins] = useState<PluginInfo[]>(() => listPlugins());
  const [status, setStatus] = useState<InstallStatus>({ kind: 'idle' });
  const [galleryOpen, setGalleryOpen] = useState(false);
  const vaultPath = useAppStore((s) => s.vaultPath);
  const setVaultPath = useAppStore((s) => s.setVaultPath);

  useEffect(() => {
    if (!isOpen) return;
    setPlugins(listPlugins());
    // Re-read whenever the manager's active-set changes.
    return subscribePlugins(() => setPlugins(listPlugins()));
  }, [isOpen]);

  // Reset the banner each time the modal re-opens so a stale error
  // from a previous session doesn't linger.
  useEffect(() => {
    if (isOpen) setStatus({ kind: 'idle' });
  }, [isOpen]);

  const toggle = (id: string, enabled: boolean) => {
    setPluginEnabled(id, enabled);
  };

  const handleUninstall = async (p: PluginInfo) => {
    if (p.category !== 'user') return;

    let effectiveVaultPath = vaultPath;
    if (!effectiveVaultPath) {
      const info = await getStorageInfo();
      effectiveVaultPath = info?.location || '';
    }
    if (!effectiveVaultPath) {
      setStatus({
        kind: 'error',
        message: t('PLUGINS_INSTALL_NO_VAULT') || 'Open a vault before installing a plugin.',
      });
      return;
    }

    try {
      await invoke('uninstall_plugin', { vaultPath: effectiveVaultPath, pluginId: p.id });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: `Uninstall failed: ${typeof err === 'string' ? err : String(err)}`,
      });
      return;
    }

    // Drop it from the in-memory registry so it disappears from the
    // list immediately. Plugin-manager takes care of tearing down the
    // live plugin first.
    unregisterPlugin(p.id);
    setPlugins(listPlugins());
    setStatus({ kind: 'success', message: `Uninstalled ${p.name}.` });
  };

  const handleInstallFromZip = async () => {
    if (status.kind === 'installing') return;
    // Store's vaultPath can be empty on fresh launches when the modal opens
    // before initApp() hydrates it. Fall back to the live storage info so
    // the user isn't blocked when the backend already has a location.
    let effectiveVaultPath = vaultPath;
    if (!effectiveVaultPath) {
      const info = await getStorageInfo();
      effectiveVaultPath = info?.location || '';
    }
    if (!effectiveVaultPath) {
      setStatus({
        kind: 'error',
        message: t('PLUGINS_INSTALL_NO_VAULT') || 'Open a vault before installing a plugin.',
      });
      return;
    }
    // Hydrate the store so hotLoadUserPluginById (which reads vaultPath
    // via getState()) sees the same value we just resolved.
    if (!vaultPath) setVaultPath(effectiveVaultPath);

    // Let the OS file picker handle cancellation — null means the user
    // hit Cancel, which is not an error.
    let picked: string | string[] | null;
    try {
      picked = await dialogOpen({
        multiple: false,
        directory: false,
        filters: [{ name: 'Plugin zip', extensions: ['zip'] }],
      });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: `Could not open file picker: ${String(err)}`,
      });
      return;
    }
    if (!picked) return;
    const zipPath = Array.isArray(picked) ? picked[0] : picked;
    if (!zipPath) return;

    setStatus({ kind: 'installing' });

    let installed: PluginInstallResult;
    try {
      installed = await invoke<PluginInstallResult>('install_plugin_from_zip', {
        zipPath,
        vaultPath: effectiveVaultPath,
      });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: `Install failed: ${typeof err === 'string' ? err : String(err)}`,
      });
      return;
    }

    const load = await hotLoadUserPluginById(installed.id);
    if (!load.ok) {
      setStatus({
        kind: 'error',
        message: `Installed ${installed.name} but activation failed: ${load.error}. Restart the app to retry.`,
      });
      setPlugins(listPlugins());
      return;
    }

    setPlugins(listPlugins());
    setStatus({
      kind: 'success',
      message: `Installed ${installed.name} v${installed.version}.`,
    });
  };

  const isInstalling = status.kind === 'installing';

  return (
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

          <span className="inline-block h-screen align-middle" aria-hidden="true">&#8203;</span>

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
              className="dialog-panel relative z-10 inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform shadow-xl rounded-2xl"
              style={{ maxWidth: '50vw' }}
            >
              <DialogTitle as="h3" className="dialog-title text-lg font-medium leading-6">
                {t('PLUGINS_MANAGE_TITLE') || 'Manage Plugins'}
              </DialogTitle>

              <div className="mt-4 flex items-center justify-end gap-4">
                <button
                  type="button"
                  className="text-xs underline-offset-2 hover:underline disabled:opacity-50"
                  disabled={isInstalling}
                  onClick={handleInstallFromZip}
                  style={{ color: 'var(--fg-secondary)', background: 'transparent', border: 'none', padding: 0 }}
                >
                  {isInstalling
                    ? (t('PLUGINS_INSTALLING') || 'Installing…')
                    : (t('PLUGINS_INSTALL_FROM_ZIP_LINK') || 'Install from zip file')}
                </button>
                <button
                  type="button"
                  className="btn btn-modal text-sm font-semibold px-4 py-2 rounded-md"
                  disabled={isInstalling}
                  onClick={() => setGalleryOpen(true)}
                  style={{
                    background: 'var(--accent, #3b82f6)',
                    color: 'var(--accent-fg, #fff)',
                    border: '1px solid var(--accent, #3b82f6)',
                  }}
                >
                  {t('PLUGINS_BROWSE_GALLERY') || 'Browse Gallery'}
                </button>
              </div>

              {status.kind === 'success' && (
                <div
                  className="mt-3 px-3 py-2 text-xs rounded"
                  style={{
                    background: 'var(--bg-secondary)',
                    color: 'var(--fg-primary)',
                    border: '1px solid var(--border)',
                  }}
                  role="status"
                >
                  {status.message}
                </div>
              )}
              {status.kind === 'error' && (
                <div
                  className="mt-3 px-3 py-2 text-xs rounded"
                  style={{
                    background: 'var(--bg-secondary)',
                    color: 'var(--danger, #c53030)',
                    border: '1px solid var(--border)',
                  }}
                  role="alert"
                >
                  {status.message}
                </div>
              )}

              <div className="mt-4 overflow-y-auto" style={{ maxHeight: '60vh' }}>
                {plugins.length === 0 ? (
                  <div className="text-sm" style={{ color: 'var(--fg-secondary)' }}>
                    {t('PLUGINS_EMPTY') || 'No plugins registered.'}
                  </div>
                ) : (
                  <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {plugins.map((p) => (
                      <li key={p.id} className="py-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">
                            {p.name}
                            <span className="ml-2 text-xs font-normal" style={{ color: 'var(--fg-secondary)' }}>
                              v{p.version}
                            </span>
                          </div>
                          {p.description && (
                            <div className="text-xs mt-0.5" style={{ color: 'var(--fg-secondary)' }}>
                              {p.description}
                            </div>
                          )}
                          <div className="text-xs mt-0.5" style={{ color: 'var(--fg-secondary)' }}>
                            <code>{p.id}</code>
                            {' · '}
                            <span>{p.active ? (t('PLUGINS_ACTIVE') || 'Active') : (t('PLUGINS_DISABLED') || 'Disabled')}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="btn btn-modal"
                            onClick={() => toggle(p.id, !p.active)}
                          >
                            {p.active
                              ? (t('PLUGINS_DISABLE') || 'Disable')
                              : (t('PLUGINS_ENABLE') || 'Enable')}
                          </button>
                          {p.category === 'user' && (
                            <button
                              type="button"
                              className="btn btn-modal"
                              onClick={() => handleUninstall(p)}
                              title={t('PLUGINS_UNINSTALL') || 'Uninstall'}
                            >
                              {t('PLUGINS_UNINSTALL') || 'Uninstall'}
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-4 text-xs" style={{ color: 'var(--fg-secondary)' }}>
                {t('PLUGINS_RUNTIME_ONLY_NOTE') || 'Changes apply until the app is restarted.'}
              </div>

              <div className="mt-4">
                <button type="button" className="btn btn-modal" onClick={onClose}>
                  {t('TEXT_OK') || 'OK'}
                </button>
              </div>
            </DialogPanel>
          </Transition.Child>
        </div>
      </Dialog>

      <PluginGalleryModal isOpen={galleryOpen} onClose={() => setGalleryOpen(false)} />
    </Transition>
  );
}
