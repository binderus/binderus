/**
 * Description: Entry point for plugin registration. Called once from the
 *   app shell at startup. Registers BUILT-IN plugins synchronously, then
 *   kicks off a background scan of <vault>/.binderus/plugins/ to load
 *   any USER plugins the vault owner has installed (dropped in as
 *   unpacked folders, or installed via future .zip install flow).
 *
 *   User plugins are NOT compiled into the app bundle — they ship as
 *   separate .zip files and are loaded at runtime via the plugin-loader.
 *
 * Inputs: none (called at app startup).
 * Outputs: side effect — built-in plugins activate immediately; user
 *   plugins activate asynchronously as their manifests are discovered.
 */

import { activatePlugin } from './plugin-manager';
import { wordCountPlugin } from './built-in/word-count';
import { pomodoroPlugin } from './built-in/pomodoro';
import { loadUserPluginsFromVault } from './plugin-loader';
import { startShortcutListener } from './shortcut-registry';

let initialized = false;

export function registerBuiltInPlugins(): void {
  if (initialized) return;
  initialized = true;

  // Global keydown listener for plugin-registered shortcuts — installed
  // once, idempotent. Runs at capture phase so it beats the built-in
  // app shortcuts when a plugin has claimed the combo.
  startShortcutListener();

  // Built-in — compiled into the app.
  activatePlugin(wordCountPlugin);
  activatePlugin(pomodoroPlugin);

  // User plugins — loaded from <vault>/.binderus/plugins/*.
  // Fire-and-forget; each plugin reports its own errors via console.
  void loadUserPluginsFromVault();
}

export {
  activatePlugin,
  deactivatePlugin,
  unregisterPlugin,
  setPluginEnabled,
  listPlugins,
  listActivePlugins,
  subscribePlugins,
  subscribeCommands,
  listPluginCommands,
} from './plugin-manager';
export type { PluginInfo } from './plugin-manager';
export type {
  AppPlugin,
  PluginContext,
  PluginStatusBarItem,
  PluginPanelDescriptor,
  PanelHandle,
  PluginSettingsApi,
  PluginCommandDescriptor,
} from './plugin-types';
