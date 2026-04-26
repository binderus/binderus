/**
 * Description: Checks for app updates by fetching the latest version from binderus.com/api/version.
 *   - checkLatestVersion(): on-demand check (e.g. What's New modal), returns update info
 *   - scheduleStartupVersionPing(): silent fire-and-forget call 10s after launch for analytics
 *   Both use the same /api/version endpoint with plain-text sanitized params for transparency.
 * Requirements: Network access
 * Inputs: None
 * Outputs: { latestVersion, updateUrl } — non-null when an update is available
 */
import { VERSION, BINDERUS_WEB_URL } from '../utils/constants';
import { httpFetch } from '../utils/api-utils';
import { isWeb } from '../utils/base-utils';
import { type as osType, version as osVersion } from '@tauri-apps/plugin-os';
import { useAppStore } from './use-app-store';

const INTERNAL_EMAIL = 'binderusapp@gmail.com';
function isInternalUser(): boolean {
  return useAppStore.getState().settingEmail?.trim().toLowerCase() === INTERNAL_EMAIL;
}

export interface VersionCheckResult {
  latestVersion: string | null;
  updateUrl: string | null;
}

interface VersionResponse {
  version: string;
  url?: string;
}

// Strip everything except a-z 0-9 . - _
function sanitize(s: string): string {
  return s.replace(/[^a-z0-9._-]/gi, '');
}

/** Get OS type + version via Tauri plugin, e.g. "macOS_15.6.1", "windows_10.0.22631" */
function getOSInfo(): string {
  if (isWeb) return 'web';
  try {
    return sanitize(`${osType()}_${osVersion()}`);
  } catch {
    return 'Unknown';
  }
}

/** Build the /api/version URL with plain-text sanitized params. src: "ping" (startup) or "check" (modal). */
function buildVersionUrl(src: 'ping' | 'check'): string {
  const ver = sanitize(VERSION);
  const os = getOSInfo();
  const lang = sanitize(navigator?.language ?? '');
  const scr = sanitize(`${screen.width}x${screen.height}`);
  const { clientUuid, settingEmail } = useAppStore.getState();
  const uid = sanitize(clientUuid ?? '');
  const email = settingEmail?.trim() ?? '';
  const emailParam = email ? `&email=${encodeURIComponent(email)}` : '';
  return `${BINDERUS_WEB_URL}/api/version?v=${ver}&os=${os}&lang=${lang}&scr=${scr}&src=${src}&uid=${uid}${emailParam}`;
}

export async function checkLatestVersion(): Promise<VersionCheckResult> {
  if (import.meta.env.DEV || isInternalUser()) return { latestVersion: null, updateUrl: null };
  try {
    const res = await httpFetch(buildVersionUrl('check'));
    const data = await res.json() as VersionResponse;
    if (data?.version && data.version !== VERSION) {
      return {
        latestVersion: data.version,
        updateUrl: data.url ?? BINDERUS_WEB_URL,
      };
    }
  } catch {
    // Silently ignore failures
  }
  return { latestVersion: null, updateUrl: null };
}

/** Fire-and-forget version check 10s after launch. Skipped in dev builds or for internal users. */
export function scheduleStartupVersionPing(): void {
  if (import.meta.env.DEV || isInternalUser()) return;
  setTimeout(() => {
    httpFetch(buildVersionUrl('ping')).catch(() => {});
  }, 10_000);
}
