/**
 * Description: Browse-and-install gallery for plugins published via the
 *   public registry at raw.githubusercontent.com/binderus/binderus/main/
 *   plugins/registry.json. Users pick a card, click Install, and the
 *   zip is downloaded from binderus.com/api/plugin, sha256-verified,
 *   and handed to the same Rust installer used by "Install from zip".
 *
 *   Intentionally minimal: card grid, install/update/installed button
 *   per card, one-line status banner. No detail drawer, no search —
 *   those land once the registry has more than a handful of plugins.
 *
 * Requirements: fetchRegistry/installFromRegistry from ../../plugins/registry,
 *   hotLoadUserPluginById from the plugin-loader, a live vault path.
 * Inputs:  isOpen, onClose.
 * Outputs: rendered dialog plus install side-effects on the vault.
 */

import { Dialog, DialogPanel, DialogTitle, Transition } from '@headlessui/react';
import { Fragment, useEffect, useMemo, useState } from 'react';

import { t } from '../../utils/base-utils';
import { useAppStore } from '../../hooks/use-app-store';
import { getStorageInfo } from '../../utils/tauri-utils';
import { listPlugins, subscribePlugins, type PluginInfo } from '../../plugins';
import { hotLoadUserPluginById } from '../../plugins/plugin-loader';
import {
  fetchRegistry,
  installFromRegistry,
  type PluginRegistry,
  type RegistryPlugin,
} from '../../plugins/registry';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; registry: PluginRegistry }
  | { kind: 'error'; message: string };

type RowState =
  | { kind: 'idle' }
  | { kind: 'installing'; id: string }
  | { kind: 'success'; id: string; message: string }
  | { kind: 'error'; id: string; message: string };

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export default function PluginGalleryModal({ isOpen, onClose }: Props) {
  const [load, setLoad] = useState<LoadState>({ kind: 'idle' });
  const [row, setRow] = useState<RowState>({ kind: 'idle' });
  const [installed, setInstalled] = useState<PluginInfo[]>(() => listPlugins());
  const vaultPath = useAppStore((s) => s.vaultPath);
  const setVaultPath = useAppStore((s) => s.setVaultPath);

  useEffect(() => {
    if (!isOpen) return;
    setInstalled(listPlugins());
    return subscribePlugins(() => setInstalled(listPlugins()));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setRow({ kind: 'idle' });
    setLoad({ kind: 'loading' });
    fetchRegistry()
      .then((registry) => setLoad({ kind: 'ready', registry }))
      .catch((err) => setLoad({ kind: 'error', message: String(err) }));
  }, [isOpen]);

  const installedById = useMemo(() => {
    const m = new Map<string, PluginInfo>();
    installed.forEach((p) => m.set(p.id, p));
    return m;
  }, [installed]);

  const handleInstall = async (plugin: RegistryPlugin) => {
    let effectiveVault = vaultPath;
    if (!effectiveVault) {
      const info = await getStorageInfo();
      effectiveVault = info?.location || '';
    }
    if (!effectiveVault) {
      setRow({
        kind: 'error',
        id: plugin.id,
        message: t('PLUGINS_INSTALL_NO_VAULT') || 'Open a vault before installing a plugin.',
      });
      return;
    }
    if (!vaultPath) setVaultPath(effectiveVault);

    setRow({ kind: 'installing', id: plugin.id });
    try {
      const result = await installFromRegistry(plugin, effectiveVault);
      const load = await hotLoadUserPluginById(result.id);
      if (!load.ok) {
        setRow({
          kind: 'error',
          id: plugin.id,
          message: `Installed ${result.name} but activation failed: ${load.error}. Restart the app.`,
        });
        return;
      }
      setRow({
        kind: 'success',
        id: plugin.id,
        message: `Installed ${result.name} v${result.version}.`,
      });
    } catch (err) {
      setRow({
        kind: 'error',
        id: plugin.id,
        message: typeof err === 'string' ? err : String(err),
      });
    }
  };

  const renderCard = (plugin: RegistryPlugin) => {
    const existing = installedById.get(plugin.id);
    const isInstalled = Boolean(existing && existing.category === 'user');
    const needsUpdate =
      isInstalled && compareVersions(plugin.version, existing!.version) > 0;
    const isBusy = row.kind === 'installing' && row.id === plugin.id;
    const rowMsg = row.kind !== 'idle' && row.id === plugin.id ? row : null;

    let label = t('PLUGINS_GALLERY_INSTALL') || 'Install';
    if (isBusy) label = t('PLUGINS_INSTALLING') || 'Installing…';
    else if (needsUpdate) label = t('PLUGINS_GALLERY_UPDATE') || `Update to ${plugin.version}`;
    else if (isInstalled) label = t('PLUGINS_GALLERY_INSTALLED') || 'Installed';

    const disabled = isBusy || (isInstalled && !needsUpdate);

    return (
      <div
        key={plugin.id}
        className="flex flex-col p-3 rounded border"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{plugin.name}</div>
            <div className="text-[11px] opacity-70 truncate">
              {plugin.author} · v{plugin.version}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-modal text-xs px-3 py-1 flex-shrink-0"
            disabled={disabled}
            onClick={() => handleInstall(plugin)}
            style={{
              background: needsUpdate || !isInstalled ? 'var(--accent, #3b82f6)' : 'transparent',
              color: needsUpdate || !isInstalled ? 'var(--accent-fg, #fff)' : 'var(--fg-primary)',
              border: '1px solid var(--accent, #3b82f6)',
              opacity: disabled && !isBusy ? 0.6 : 1,
            }}
          >
            {label}
          </button>
        </div>
        <p className="mt-2 text-xs opacity-80 line-clamp-3">{plugin.description}</p>
        {rowMsg && (
          <div
            className="mt-2 text-[11px] px-2 py-1 rounded"
            style={{
              background: rowMsg.kind === 'error' ? 'var(--danger-bg, #fee)' : 'var(--bg-primary)',
              color: rowMsg.kind === 'error' ? 'var(--danger-fg, #900)' : 'var(--fg-primary)',
            }}
          >
            {'message' in rowMsg ? rowMsg.message : ''}
          </div>
        )}
      </div>
    );
  };

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
              className="dialog-panel relative z-10 inline-block w-full p-6 my-8 overflow-hidden text-left align-middle transition-all transform shadow-xl rounded-2xl"
              style={{ maxWidth: '60vw' }}
            >
              <div className="flex items-center justify-between">
                <DialogTitle as="h3" className="dialog-title text-lg font-medium leading-6">
                  {t('PLUGINS_GALLERY_TITLE') || 'Plugin Gallery'}
                </DialogTitle>
                <button
                  type="button"
                  className="text-xs opacity-70 hover:opacity-100"
                  onClick={() => {
                    setLoad({ kind: 'loading' });
                    fetchRegistry(true)
                      .then((registry) => setLoad({ kind: 'ready', registry }))
                      .catch((err) => setLoad({ kind: 'error', message: String(err) }));
                  }}
                >
                  {t('PLUGINS_GALLERY_REFRESH') || 'Refresh'}
                </button>
              </div>

              <div className="mt-4 min-h-[200px]">
                {load.kind === 'loading' && (
                  <div className="text-sm opacity-70">{t('PLUGINS_GALLERY_LOADING') || 'Loading…'}</div>
                )}
                {load.kind === 'error' && (
                  <div className="text-sm" style={{ color: 'var(--danger-fg, #900)' }}>
                    {load.message}
                  </div>
                )}
                {load.kind === 'ready' && load.registry.plugins.length === 0 && (
                  <div className="text-sm opacity-70">
                    {t('PLUGINS_GALLERY_EMPTY') || 'No plugins published yet.'}
                  </div>
                )}
                {load.kind === 'ready' && load.registry.plugins.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {load.registry.plugins.map(renderCard)}
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  className="btn btn-modal text-sm px-4 py-1.5"
                  onClick={onClose}
                >
                  {t('CLOSE') || 'Close'}
                </button>
              </div>
            </DialogPanel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
