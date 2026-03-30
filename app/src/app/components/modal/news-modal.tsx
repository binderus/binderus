/**
 * Description: "What's New" modal that fetches and renders remote Markdown changelog content.
 *   Replaces the previous iframe approach with native react-markdown rendering for consistent
 *   styling, dark mode support, and better performance.
 * Requirements: react-markdown, remark-gfm, swr
 * Inputs: isOpen (boolean), onClose (function)
 * Outputs: Renders a modal dialog with remotely-fetched changelog content
 */

import { Dialog, DialogPanel, DialogTitle, Transition } from '@headlessui/react';
import { Fragment, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useSWR from 'swr';
import { httpFetch } from '../../utils/api-utils';
import { t, getUserGuideUrl } from '../../utils/base-utils';
import { open } from '@tauri-apps/plugin-shell';
import { BINDERUS_WEB_NAME, BINDERUS_WEB_URL, VERSION } from '../../utils/constants';
import Spinner from '../spinner/spinner';
import { checkLatestVersion, VersionCheckResult } from '../../hooks/use-version-check';
import { useAppContext } from '../../hooks/use-app-context';

const WHATS_NEW_URL = 'https://www.binderus.com/whats-new';

const getWhatsNewUrl = (lang: string) => {
  const suffix = lang && lang !== 'en-US' ? `-${lang.toLowerCase()}` : '';
  return `${WHATS_NEW_URL}${suffix}.md`;
};

const fetcher = (url: string) =>
  httpFetch(url, { cache: 'no-store' }).then((res) => {
    if (!res.ok) throw new Error('Failed to load');
    return res.text();
  });

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function NewsModal({ isOpen, onClose }: Props) {
  const { lang } = useAppContext();
  const { data: content, error, isLoading } = useSWR(isOpen ? getWhatsNewUrl(lang) : null, fetcher, {
    revalidateOnFocus: false
  });
  const [versionInfo, setVersionInfo] = useState<VersionCheckResult>({ latestVersion: null, updateUrl: null });

  useEffect(() => {
    if (isOpen) checkLatestVersion().then(setVersionInfo);
  }, [isOpen]);

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
              <DialogTitle
                as="h3"
                className="dialog-title flex items-center justify-between text-lg font-medium leading-6"
              >
                <div>{t('APP_MAIN_WHATS_NEW')}</div>
                <div className="text-sm flex items-center gap-2" style={{ color: 'var(--fg-secondary)' }}>
                  {t('TEXT_CURRENT_VERSION')}: {VERSION}
                  {versionInfo.latestVersion && (
                    <a href="#" onClick={(e) => { e.preventDefault(); if (versionInfo.updateUrl) open(versionInfo.updateUrl); }}
                      className="text-xs px-2 py-0.5 rounded-full bg-green-600 text-white hover:bg-green-500">
                      v{versionInfo.latestVersion} available
                    </a>
                  )}
                </div>
              </DialogTitle>

              <div className="mt-2 space-y-2">
                <div>
                  {t('SETTING_VISIT_TO_DOWNLOAD')}:{' '}
                  <a href="#" onClick={(e) => { e.preventDefault(); open(BINDERUS_WEB_URL); }} className="text-blue-400 hover:text-blue-600 cursor-pointer">
                    {BINDERUS_WEB_NAME}
                  </a>
                </div>
                <div>
                  {t('SETTING_VISIT_USER_GUIDE')}:{' '}
                  <a href="#" onClick={(e) => { e.preventDefault(); open(getUserGuideUrl(lang)); }} className="text-blue-400 hover:text-blue-600 cursor-pointer">
                    {t('TEXT_USER_GUIDE')}
                  </a>
                </div>
              </div>

              <hr className="mt-4" />

              <div className="mt-2 overflow-y-auto text-sm" style={{ height: '60vh', color: 'var(--dialog-fg)' }}>
                {isLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Spinner />
                  </div>
                ) : error ? (
                  <p className="text-red-500 text-sm mt-2">Failed to load changelog. Please check your connection.</p>
                ) : content ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-lg font-semibold mt-4 mb-2 border-b pb-1">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-1">{children}</h3>,
                      ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
                      li: ({ children }) => <li className="text-sm">{children}</li>,
                      a: ({ href, children }) => (
                        <a href="#" onClick={(e) => { e.preventDefault(); if (href) open(href); }} className="text-blue-500 hover:underline cursor-pointer">
                          {children}
                        </a>
                      ),
                      code: ({ children }) => (
                        <code className="px-1 rounded text-xs font-mono" style={{ backgroundColor: 'var(--editor-code-bg)' }}>{children}</code>
                      ),
                      p: ({ children }) => <p className="mb-2">{children}</p>
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                ) : null}
              </div>

              <div className="mt-4">
                <button type="button" className="btn btn-modal" onClick={onClose}>
                  {t('TEXT_OK')}
                </button>
              </div>
            </DialogPanel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
