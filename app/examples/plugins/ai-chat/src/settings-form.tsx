/**
 * Description: Settings editor for the AI Chat plugin. Renders inside
 *   the slide-out panel when the user taps ⚙. Provider dropdown picks
 *   a preset (Ollama / OpenAI / DeepInfra / Groq / Together /
 *   OpenRouter / LM Studio / Custom) which seeds baseUrl + example
 *   model id; the user can still override anything manually.
 *
 *   API key is a password-masked input. It's stored in the plugin
 *   settings bag — fine for a local-first single-user desktop app,
 *   but note that vault settings are NOT encrypted by default.
 */

import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_SETTINGS, PROVIDERS, type AIChatPluginSettings, type ProviderKey } from './types';
import { chat, listModels, pingServer } from './llm-client';
import curatedModels from './provider-models.json';
import manifest from '../manifest.json';

interface Props {
  initial: AIChatPluginSettings;
  availableModels: string[];
  onSave: (next: AIChatPluginSettings) => void;
  onCancel: () => void;
}

type ProbeState =
  | { status: 'idle' }
  | { status: 'probing' }
  | { status: 'ok'; reply: string }
  | { status: 'error'; error: string };

const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map((p) => [p.key, p])) as Record<
  ProviderKey,
  (typeof PROVIDERS)[number]
>;

export default function SettingsForm({ initial, availableModels: _ignoredFromParent, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<AIChatPluginSettings>(initial);
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' });
  // Fetch /models against `draft` (not saved settings) so switching provider
  // in the form immediately refreshes the suggestion list before Save.
  const [liveModels, setLiveModels] = useState<string[]>([]);

  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  useEffect(() => {
    if (!draft.baseUrl) {
      setLiveModels([]);
      return;
    }
    const ctrl = new AbortController();
    listModels(draft.baseUrl, draft.apiKey || undefined, ctrl.signal)
      .then((ids) => { if (!ctrl.signal.aborted) setLiveModels(ids); })
      .catch(() => { if (!ctrl.signal.aborted) setLiveModels([]); });
    return () => ctrl.abort();
  }, [draft.baseUrl, draft.apiKey]);

  const update = <K extends keyof AIChatPluginSettings>(
    key: K,
    value: AIChatPluginSettings[K],
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const preset = PROVIDER_MAP[draft.provider] ?? PROVIDER_MAP.custom;

  const applyPreset = (key: ProviderKey) => {
    const p = PROVIDER_MAP[key];
    if (!p) return;
    setDraft((prev) => ({
      ...prev,
      provider: key,
      // Only overwrite baseUrl/model when switching from a different preset,
      // so a user tweaking a custom URL isn't nuked on re-render.
      baseUrl: p.baseUrl || prev.baseUrl,
      model: p.exampleModel || prev.model,
    }));
    setProbe({ status: 'idle' });
  };

  const testConnection = async () => {
    setProbe({ status: 'probing' });
    const ping = await pingServer(draft.baseUrl, draft.apiKey || undefined);
    if (!ping.ok) {
      setProbe({ status: 'error', error: ping.error });
      return;
    }
    if (!draft.model) {
      setProbe({ status: 'error', error: 'No model selected' });
      return;
    }
    try {
      const reply = await chat({
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey || undefined,
        model: draft.model,
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: draft.temperature,
        streaming: false,
      });
      setProbe({ status: 'ok', reply: reply.trim() || '(empty reply)' });
    } catch (err) {
      setProbe({ status: 'error', error: (err as Error).message });
    }
  };

  const modelOptions = useMemo(() => {
    // Local servers (Ollama / LM Studio) advertise exactly what's installed,
    // so suggesting curated ids the user hasn't pulled would only produce
    // 404s. For cloud providers /models is filtered, so merge with the
    // curated list to help users discover popular ids.
    const authoritative = draft.provider === 'ollama' || draft.provider === 'lmstudio';
    if (authoritative) return Array.from(new Set(liveModels)).sort();
    const curated = (curatedModels as Record<string, string[]>)[draft.provider] ?? [];
    return Array.from(new Set([...liveModels, ...curated])).sort();
  }, [liveModels, draft.provider]);

  const probeLine = useMemo(() => {
    switch (probe.status) {
      case 'idle':    return null;
      case 'probing': return <span className="text-xs text-gray-400">Testing inference…</span>;
      case 'ok':      return (
        <span className="text-xs block" style={{ color: 'rgb(52,199,89)' }}>
          ✔ Reply: <span className="text-gray-300">{probe.reply.slice(0, 120)}{probe.reply.length > 120 ? '…' : ''}</span>
        </span>
      );
      case 'error':   return <span className="text-xs" style={{ color: 'rgb(255,69,58)' }}>✖ {probe.error}</span>;
    }
  }, [probe]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] flex items-center gap-2 text-xs">
        <span className="text-gray-300 font-medium">AI Chat · Settings</span>
        <div className="ml-auto flex gap-2">
          <button className="text-xs text-gray-400 hover:text-white" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-modal text-xs" onClick={() => onSave(draft)}>
            Save
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        {/* Provider */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Provider</label>
          <select
            value={draft.provider}
            onChange={(e) => applyPreset(e.target.value as ProviderKey)}
            className="w-full text-xs p-2 bg-transparent border border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] rounded text-[var(--color-text)] outline-none"
          >
            {PROVIDERS.map((p) => (
              <option key={p.key} value={p.key} className="bg-[var(--bg-primary,#1e1e1e)]">
                {p.label}
              </option>
            ))}
          </select>
          {preset.docsUrl && (
            <p className="text-xs text-gray-500 mt-1">
              Browse available models:{' '}
              <a
                href={preset.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-gray-300"
              >
                {preset.docsUrl}
              </a>
            </p>
          )}
        </div>

        {/* Base URL */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Base URL</label>
          <input
            type="text"
            value={draft.baseUrl}
            placeholder="https://api.example.com/v1"
            onChange={(e) => update('baseUrl', e.target.value)}
            className="w-full font-mono text-xs p-2 bg-transparent border border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] rounded text-[var(--color-text)] outline-none"
          />
          <p className="text-xs text-gray-500 mt-2">
            OpenAI-compatible endpoint (expects <code>/chat/completions</code> and <code>/models</code>).
          </p>
        </div>

        {/* API key (only when the preset needs one, but always editable for Custom) */}
        {(preset.requiresApiKey || draft.provider === 'custom') && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              API key{preset.requiresApiKey && <span className="text-red-400"> *</span>}
            </label>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft.apiKey}
              placeholder="sk-…"
              onChange={(e) => update('apiKey', e.target.value)}
              className="w-full font-mono text-xs p-2 bg-transparent border border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] rounded text-[var(--color-text)] outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              Sent as <code>Authorization: Bearer …</code>. Stored in the vault's plugin settings.
            </p>
          </div>
        )}

        {/* Model — free text with autocomplete from live /models ∪ curated list. */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Model</label>
          <input
            type="text"
            list="ai-chat-model-options"
            value={draft.model}
            placeholder={preset.exampleModel || 'model-id'}
            onChange={(e) => update('model', e.target.value)}
            className="w-full font-mono text-xs p-2 bg-transparent border border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] rounded text-[var(--color-text)] outline-none"
          />
          <datalist id="ai-chat-model-options">
            {modelOptions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <p className="text-xs text-gray-500 mt-1">
            {liveModels.length === 0
              ? `Server unreachable — pick from ${modelOptions.length} suggested id(s) or type your own.`
              : `${liveModels.length} advertised by the server${modelOptions.length > liveModels.length ? ` + ${modelOptions.length - liveModels.length} curated` : ''}. Any model id is accepted.`}
          </p>
        </div>

        {/* Temperature */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Temperature: <span className="text-gray-300">{draft.temperature.toFixed(2)}</span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft.temperature}
            onChange={(e) => update('temperature', Number(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-gray-500 mt-1">
            Lower is more deterministic. 0.2–0.4 is a good default for notes.
          </p>
        </div>

        {/* Max context chars */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Max context characters</label>
          <input
            type="number"
            min={1000}
            step={1000}
            value={draft.maxContextChars}
            onChange={(e) => update('maxContextChars', Math.max(0, Number(e.target.value) || 0))}
            className="w-full font-mono text-xs p-2 bg-transparent border border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] rounded text-[var(--color-text)] outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            Cap on the context blob appended to your prompt. Default{' '}
            <code>{DEFAULT_SETTINGS.maxContextChars.toLocaleString()}</code>.
          </p>
        </div>

        {/* System prompt */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">System prompt</label>
          <textarea
            rows={4}
            value={draft.systemPrompt}
            onChange={(e) => update('systemPrompt', e.target.value)}
            className="w-full text-xs p-2 bg-transparent border border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] rounded text-[var(--color-text)] outline-none"
          />
        </div>

        {/* Streaming */}
        <div className="flex items-center gap-2">
          <input
            id="ai-chat-streaming"
            type="checkbox"
            checked={draft.streaming}
            onChange={(e) => update('streaming', e.target.checked)}
          />
          <label htmlFor="ai-chat-streaming" className="text-xs text-gray-300">
            Stream tokens as they arrive
          </label>
        </div>

        {/* Test — runs a real inference with every param above, so it
            lives at the bottom where it can act on the full draft. */}
        <div className="pt-2 border-t border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)]">
          <div className="flex items-center gap-2">
            <button
              className="btn btn-modal text-xs"
              onClick={() => void testConnection()}
              disabled={probe.status === 'probing' || !draft.baseUrl || !draft.model}
            >
              Test connection
            </button>
            <div className="flex-1 min-h-[14px] text-right">{probeLine}</div>
          </div>
        </div>

        {/* Reset */}
        <div>
          <button
            className="text-xs text-gray-400 hover:text-white"
            onClick={() => setDraft(DEFAULT_SETTINGS)}
          >
            Reset to defaults
          </button>
        </div>

        {/* Version — read from manifest.json so it stays in sync with the
            shipped plugin and cannot drift from what the host reports. */}
        <div className="pt-2 text-[11px] text-gray-500 text-right">
          v{manifest.version}
        </div>
      </div>
    </div>
  );
}
