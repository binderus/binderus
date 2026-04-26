/**
 * Description: Thin wrappers around @tauri-apps/plugin-log so JS code can log
 *   into the shared `<config_dir>/Binderus/debug.log` file without sprinkling
 *   Tauri-specific imports everywhere. Safe to call from anywhere — in web
 *   builds (no Tauri) the calls no-op quietly.
 * Requirements: @tauri-apps/plugin-log registered on the Rust side.
 * Inputs: message strings (formatted by caller).
 * Outputs: writes to the log file + Rust stdout; fire-and-forget.
 */
import { info as pInfo, warn as pWarn, error as pError, debug as pDebug } from '@tauri-apps/plugin-log';

const swallow = () => { /* non-Tauri context or plugin unavailable */ };

export const log = {
  debug: (msg: string) => { void pDebug(msg).catch(swallow); },
  info: (msg: string) => { void pInfo(msg).catch(swallow); },
  warn: (msg: string) => { void pWarn(msg).catch(swallow); },
  error: (msg: string) => { void pError(msg).catch(swallow); },
};
