/**
 * Description: User-plugin entry point. Exports a FACTORY that the host
 *   calls with a `PluginApi` bag; the factory returns the `AppPlugin`.
 *
 *   The factory indirection guarantees the runtime global injected by
 *   the host (React, invoke) is resolved by the shim files BEFORE the
 *   AppPlugin is constructed.
 *
 * Inputs: `PluginApi` provided by the host at load time.
 * Outputs: an `AppPlugin` which the host registers and activates.
 *
 * NOTE: This file is `.ts` (no JSX) — React components are created via
 *   `api.createElement` so the plugin never needs its own JSX pragma.
 */

import enUS from './locales/en-US.json';
import manifest from '../manifest.json';
import type { AppPlugin, PluginApi, PluginContext, PluginFactory } from './host-types';
import { DEFAULT_SETTINGS, type AIChatPluginSettings } from './types';
import { installSelectionListener } from './context-gatherer';
import AIChatPanel from './panel';

const pluginFactory: PluginFactory = (api: PluginApi): AppPlugin => {
  // Local reference to createElement — cached once per factory call so
  // the hot path (panel render) does not re-read through the api object.
  const h = api.createElement;

  return {
    id: manifest.id,
    name: manifest.name,
    // Single source of truth: manifest.json is bumped by
    // tools/update-plugin-version.sh and read here via a bundled import
    // so host-reported version always matches the shipped zip.
    version: manifest.version,
    description:
      'Chat with any OpenAI-compatible LLM — local Ollama/LM Studio, or cloud providers like OpenAI, DeepInfra, Groq, Together, OpenRouter. Supports editor/selection/files/directory as context.',
    category: 'user',
    locales: { 'en-US': enUS },

    activate(ctx: PluginContext) {
      // 1. Seed default settings on first run (merge, do not overwrite).
      const current = ctx.settings.get() as Partial<AIChatPluginSettings>;
      ctx.settings.set({ ...DEFAULT_SETTINGS, ...current });

      // 2. Install selection listener for the "Selection" context mode.
      const removeSelectionListener = installSelectionListener();

      // 3. Register the slide-out panel. Auto-registers a toggle command.
      const panel = ctx.panel.register({
        id: 'panel',
        title: ctx.t('PLUGIN_AI_CHAT_TITLE', 'AI Chat'),
        side: 'right',
        widthPct: 40,
        registerCommand: true,
        render: ({ close }) => h(AIChatPanel, { ctx, close }),
      });

      // 4. Register a dedicated "Open AI Chat" command.
      ctx.commands.register({
        id: 'open',
        label: ctx.t('PLUGIN_AI_CHAT_OPEN', 'Open AI Chat'),
        onSelect: () => panel.show(),
      });

      // 5. Cmd+L (Ctrl+L on Windows/Linux) — toggle the AI Chat panel.
      //    Takes precedence over the built-in Lock shortcut when this
      //    plugin is active.
      ctx.shortcuts.register('Cmd+L', () => panel.toggle());

      ctx.log('activated');

      return () => {
        removeSelectionListener();
        panel.dispose();
        ctx.log('deactivated');
      };
    },
  };
};

export default pluginFactory;
