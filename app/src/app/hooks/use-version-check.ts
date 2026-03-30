/**
 * Description: Checks for app updates by fetching the latest version from binderus.com.
 *   Called on-demand (e.g. when the What's New modal opens) — not automatically on startup.
 * Requirements: Network access
 * Inputs: None
 * Outputs: { latestVersion, updateUrl } — non-null when an update is available
 */
import { VERSION, BINDERUS_WEB_URL } from '../utils/constants';
import { httpFetch } from '../utils/api-utils';

export interface VersionCheckResult {
  latestVersion: string | null;
  updateUrl: string | null;
}

interface VersionResponse {
  version: string;
  url?: string;
}

function navInfo(): string {
  const { language, platform, userAgent } = window.navigator;
  const s = `${platform}|${language}|${screen.width}x${screen.height}|${userAgent}`;
  return btoa(s);
}

export async function checkLatestVersion(): Promise<VersionCheckResult> {
  try {
    const url = `${BINDERUS_WEB_URL}/api/version?current=${encodeURIComponent(VERSION)}&s=${navInfo()}`;
    const res = await httpFetch(url);
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
