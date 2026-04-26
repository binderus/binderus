/**
 * Description: Slide-out AI Chat panel. Renders the consolidated
 *   header (model/provider/context in one row), the message list, and
 *   the composer. Uses ctx.settings for persistence and ctx.editor
 *   for live document access.
 *
 * UI patterns used (Copilot Chat / Cursor / Raycast AI style):
 *   - Single-row header with status dot, model picker, provider,
 *     context picker, clear, settings, close.
 *   - Empty state with one-click starter prompts.
 *   - Context chip ("Editor · 3.2 KB") directly above the composer so
 *     the user sees exactly what's being attached.
 *   - Composer with an embedded send button — Cmd/Ctrl+Enter to send.
 *   - Mid-stream Stop + post-message Copy on assistant replies.
 */

import React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PluginContext } from './host-types';
import type { AIChatPluginSettings, ChatMessage, ContextMode } from './types';
import { DEFAULT_SETTINGS } from './types';
import { chat, listModels, pingServer, toOpenAIMessages } from './llm-client';
import { gatherContext } from './context-gatherer';
import SettingsForm from './settings-form';

interface Props {
  ctx: PluginContext;
  close: () => void;
}

const MODE_OPTIONS: Array<{ value: ContextMode; label: string; hint: string }> = [
  { value: 'editor',    label: 'Editor',    hint: 'Active tab' },
  { value: 'selection', label: 'Selection', hint: 'Highlighted text' },
  { value: 'files',     label: 'Files',     hint: 'Specific file paths' },
  { value: 'directory', label: 'Directory', hint: 'Recursive folder' },
];

const STARTERS: Array<{ label: string; prompt: string }> = [
  { label: 'Summarise',          prompt: 'Summarise this note in 5 concise bullets.' },
  { label: 'Extract action items', prompt: 'List every action item, owner, and deadline mentioned. Return a checklist.' },
  { label: 'Critique',           prompt: 'Critique this note: what is unclear, missing, or weak?' },
  { label: 'Rewrite clearly',    prompt: 'Rewrite this in clear, concise prose. Preserve every fact and structural heading.' },
];

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Parent directory of a file path, handling `/` and `\` separators. */
function parentDir(filePath: string): string {
  const normalised = filePath.replace(/\\/g, '/');
  const idx = normalised.lastIndexOf('/');
  return idx > 0 ? normalised.slice(0, idx) : '';
}

export default function AIChatPanel({ ctx, close }: Props) {
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const [settings, setSettings] = useState<AIChatPluginSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...(ctx.settings.get() as Partial<AIChatPluginSettings>),
  }));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<ContextMode>('editor');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [directoryPath, setDirectoryPath] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connection, setConnection] = useState<'unknown' | 'ok' | 'down'>('unknown');
  const [contextStats, setContextStats] = useState<{
    bytes: number;
    filesConsidered: number;
    filesIncluded: number;
    truncated: boolean;
    warnings: string[];
  }>({ bytes: 0, filesConsidered: 0, filesIncluded: 0, truncated: false, warnings: [] });
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const off = ctx.settings.onChange((next) => {
      setSettings({ ...DEFAULT_SETTINGS, ...(next as Partial<AIChatPluginSettings>) });
    });
    return off;
  }, [ctx.settings]);

  // Probe the configured endpoint on open + whenever baseUrl/apiKey changes.
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      const res = await pingServer(settings.baseUrl, settings.apiKey || undefined, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setConnection(res.ok ? 'ok' : 'down');
    })();
    return () => ctrl.abort();
  }, [settings.baseUrl, settings.apiKey]);

  // Fetch models whenever the server becomes reachable or creds change.
  useEffect(() => {
    if (connection !== 'ok') return;
    const ctrl = new AbortController();
    listModels(settings.baseUrl, settings.apiKey || undefined, ctrl.signal)
      .then(setAvailableModels)
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        console.warn('[ai-chat] listModels failed', err);
      });
    return () => ctrl.abort();
  }, [connection, settings.baseUrl, settings.apiKey]);

  // For local servers (Ollama / LM Studio) /models is authoritative, so
  // if the saved model isn't served, fall back to the first available
  // one. Cloud providers filter /models aggressively (DeepInfra shows 5
  // of hundreds, OpenRouter filters by account), so we leave the user's
  // typed id alone there.
  useEffect(() => {
    if (availableModels.length === 0) return;
    const authoritative = settings.provider === 'ollama' || settings.provider === 'lmstudio';
    if (!authoritative) return;
    if (availableModels.includes(settings.model)) return;
    const next = { ...settings, model: availableModels[0] };
    ctx.settings.set(next);
    setSettings(next);
  }, [availableModels, settings, ctx.settings]);

  // Auto-scroll on new messages.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // When the user picks "Directory" with no path set yet, default to the
  // parent folder of the currently open tab. Keeps the user's manual
  // overrides alone (only seeds when the field is empty).
  useEffect(() => {
    if (mode !== 'directory' || directoryPath) return;
    const doc = ctx.editor.getActiveDocument();
    const dir = doc?.path ? parentDir(doc.path) : '';
    if (dir) setDirectoryPath(dir);
  }, [mode, directoryPath, ctx]);

  // Live-estimate what'll be attached so the user can see the payload
  // size before sending. Recomputes when the selection inputs change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const gathered = await gatherContext({
          mode,
          ctx,
          selectedFiles,
          directoryPath,
          maxChars: settings.maxContextChars,
        });
        if (cancelled) return;
        setContextStats({
          bytes: gathered.text.length,
          filesConsidered: gathered.filesConsidered,
          filesIncluded: gathered.filesIncluded,
          truncated: gathered.truncated,
          warnings: gathered.warnings,
        });
      } catch {
        if (!cancelled) {
          setContextStats({ bytes: 0, filesConsidered: 0, filesIncluded: 0, truncated: false, warnings: [] });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [mode, selectedFiles, directoryPath, settings.maxContextChars, ctx]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || status === 'sending') return;

    setStatus('sending');
    setErrorMessage(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const gathered = await gatherContext({
      mode,
      ctx,
      selectedFiles,
      directoryPath,
      maxChars: settings.maxContextChars,
    });

    if (gathered.warnings.length > 0) ctx.log('gather warnings:', gathered.warnings);
    ctx.log('context', {
      sources: gathered.sources,
      chars: gathered.text.length,
      truncated: gathered.truncated,
    });

    const systemMsgs: ChatMessage[] = settings.systemPrompt
      ? [{ id: genId(), role: 'system', content: settings.systemPrompt, timestamp: Date.now() }]
      : [];

    const contextNote = gathered.text
      ? `\n\n[Context — sources: ${gathered.sources.join(', ') || 'none'}${gathered.truncated ? ', TRUNCATED' : ''}]\n${gathered.text}`
      : '';

    const userMsg: ChatMessage = {
      id: genId(),
      role: 'user',
      content: trimmed + contextNote,
      timestamp: Date.now(),
    };
    const assistantMsg: ChatMessage = {
      id: genId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      pending: true,
    };

    const displayUserMsg: ChatMessage = { ...userMsg, content: trimmed };
    setMessages((prev) => [...prev, displayUserMsg, assistantMsg]);
    setInput('');

    try {
      const outboundMessages = [...systemMsgs, ...messages, userMsg];
      const result = await chat({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey || undefined,
        model: settings.model,
        messages: toOpenAIMessages(outboundMessages),
        temperature: settings.temperature,
        streaming: settings.streaming,
        signal: ctrl.signal,
        onDelta: (delta) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + delta } : m)),
          );
        },
      });

      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: result || m.content, pending: false } : m)),
      );
      setStatus('idle');
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, pending: false, content: m.content + '\n\n[stopped]' } : m)),
        );
        setStatus('idle');
        return;
      }
      const msg = (err as Error).message;
      setErrorMessage(msg);
      setStatus('error');
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, pending: false, content: `[error] ${msg}` } : m)),
      );
    } finally {
      abortRef.current = null;
    }
  }, [
    input, status, mode, selectedFiles, directoryPath, messages, ctx,
    settings.baseUrl, settings.apiKey, settings.model, settings.systemPrompt,
    settings.streaming, settings.temperature, settings.maxContextChars,
  ]);

  const clearChat = () => setMessages([]);

  const onSettingsSave = (next: AIChatPluginSettings) => {
    ctx.settings.set(next);
    setSettings(next);
    setView('chat');
  };

  const copyMessage = (content: string) => {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(content).catch(() => { /* ignore */ });
    }
  };

  const connectionDot = connection === 'ok'
    ? { color: 'rgb(52,199,89)', title: 'Connected' }
    : connection === 'down'
    ? { color: 'rgb(255,69,58)', title: "Can't reach server" }
    : { color: 'rgb(142,142,147)', title: 'Probing…' };

  const providerLabel = settings.provider === 'custom' ? 'Custom' : settings.provider;
  const canSend = input.trim() !== '' && connection === 'ok' && status !== 'sending';

  if (view === 'settings') {
    return (
      <SettingsForm
        initial={settings}
        availableModels={availableModels}
        onSave={onSettingsSave}
        onCancel={() => setView('chat')}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Consolidated header: status + model + provider + context + actions */}
      <div className="px-3 py-2 border-b border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] flex items-center gap-2 text-xs">
        <span
          title={connectionDot.title}
          style={{ color: connectionDot.color, fontSize: '10px' }}
        >
          ●
        </span>

        {/* Model picker — free text with /models autocomplete so cloud users
            can type any id, not just the 5–10 their server advertises. */}
        <input
          type="text"
          list="ai-chat-panel-model-options"
          value={settings.model}
          onChange={(e) => {
            const next = { ...settings, model: e.target.value };
            ctx.settings.set(next);
            setSettings(next);
          }}
          className="text-xs bg-transparent border border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] rounded px-1 py-0.5 text-[var(--color-text)] outline-none hover:border-gray-500 flex-1 min-w-[120px] font-mono"
          title="Model"
          placeholder="model-id"
        />
        <datalist id="ai-chat-panel-model-options">
          {availableModels.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>

        <span className="text-gray-500" title={settings.baseUrl}>· {providerLabel}</span>

        {/* Context mode picker — compact select, not four buttons */}
        <span className="text-gray-500">·</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as ContextMode)}
          className="text-xs bg-transparent border border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] rounded px-1 py-0.5 text-[var(--color-text)] outline-none hover:border-gray-500"
          title="Context mode"
        >
          {MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} className="bg-[var(--bg-primary,#1e1e1e)]">
              {o.label}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-3">
          <button
            className="text-gray-400 hover:text-white disabled:opacity-40"
            onClick={clearChat}
            disabled={messages.length === 0}
            title="Clear chat"
            aria-label="Clear chat"
          >
            {/* Inline trash SVG — renders identically across fonts / platforms
                and stays crisp at any size (unlike the emoji wastebasket). */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
          <button
            className="text-gray-400 hover:text-white text-lg leading-none"
            onClick={() => setView('settings')}
            title="Settings"
          >
            ⚙
          </button>
          {/* Host panel already provides a close button — avoid duplicating. */}
        </div>
      </div>

      {/* Mode-specific inputs (only shown when needed) */}
      {(mode === 'files' || mode === 'directory') && (
        <div className="px-3 py-2 border-b border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)]">
          {mode === 'files' && (
            <textarea
              rows={2}
              placeholder="One file path per line."
              className="w-full text-xs font-mono p-2 bg-transparent border border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] rounded text-[var(--color-text)] outline-none"
              value={selectedFiles.join('\n')}
              onChange={(e) => setSelectedFiles(
                e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
              )}
            />
          )}
          {mode === 'directory' && (
            <input
              type="text"
              placeholder="/absolute/path/to/folder"
              className="w-full text-xs font-mono p-2 bg-transparent border border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] rounded text-[var(--color-text)] outline-none"
              value={directoryPath}
              onChange={(e) => setDirectoryPath(e.target.value)}
            />
          )}
        </div>
      )}

      {/* Chat messages or empty state */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-3 pt-8 px-4">
            <div className="text-xs text-gray-500 text-center">
              Ask anything — your prompt will include the selected context.
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-full">
              {STARTERS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => {
                    setInput(s.prompt);
                    textareaRef.current?.focus();
                  }}
                  className="text-xs px-3 py-1.5 rounded-full border border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] text-gray-300 hover:border-gray-400 hover:text-white transition"
                >
                  {s.label}
                </button>
              ))}
            </div>
            {connection === 'down' && (
              <div className="text-xs text-red-400 text-center max-w-xs">
                Can't reach <code>{settings.baseUrl}</code>. Open ⚙ Settings to choose a
                provider or check your server.
              </div>
            )}
          </div>
        ) : (
          messages.filter((m) => m.role !== 'system').map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} group`}
            >
              <div className="max-w-[85%] flex flex-col">
                <div
                  className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'bg-[var(--bg-secondary,#2a2a2a)] text-[var(--color-text)]'
                  }`}
                >
                  {m.content}
                  {m.pending && (
                    <span className="inline-block ml-1 opacity-60 animate-pulse">▍</span>
                  )}
                </div>
                {m.role === 'assistant' && !m.pending && m.content && (
                  <button
                    className="self-start mt-1 text-[10px] text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition"
                    onClick={() => copyMessage(m.content)}
                    title="Copy reply"
                  >
                    Copy
                  </button>
                )}
              </div>
            </div>
          ))
        )}
        {errorMessage && (
          <div className="text-xs text-red-400 border border-red-600 rounded p-2">
            {errorMessage}
          </div>
        )}
      </div>

      {/* Context chip + composer */}
      <div className="border-t border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] p-3 space-y-2">
        <div className="flex items-center justify-between text-[11px] text-gray-500">
          <span className="flex items-center gap-1 flex-wrap">
            <span>
              Context:{' '}
              <span className="text-gray-300">
                {MODE_OPTIONS.find((o) => o.value === mode)?.label}
              </span>
            </span>
            {(mode === 'files' || mode === 'directory') && contextStats.filesConsidered > 0 && (
              <span className="text-gray-500">
                · {contextStats.filesIncluded} of {contextStats.filesConsidered} files
              </span>
            )}
            {contextStats.bytes > 0 && (
              <span className="text-gray-500">· {formatBytes(contextStats.bytes)}</span>
            )}
            {contextStats.truncated && (
              <span
                className="text-amber-400"
                title="Context exceeded maxContextChars — trailing files were dropped or cut."
              >
                · truncated
              </span>
            )}
          </span>
          <span className="text-gray-600">Cmd/Ctrl+Enter</span>
        </div>
        {contextStats.warnings.length > 0 && (
          <div
            className="text-[10px] text-amber-400/80 leading-tight"
            title={contextStats.warnings.join('\n')}
          >
            {contextStats.warnings[0]}
            {contextStats.warnings.length > 1 && ` (+${contextStats.warnings.length - 1} more)`}
          </div>
        )}

        <div className="relative">
          <textarea
            ref={textareaRef}
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={connection === 'down' ? "Can't reach server — open Settings" : 'Message…'}
            disabled={connection === 'down'}
            className="w-full resize-none bg-transparent text-sm p-2 pr-14 pb-12 outline-none border border-[color-mix(in_srgb,var(--color-border-primary)_80%,transparent)] rounded text-[var(--color-text)] focus:border-gray-400 disabled:opacity-50"
          />
          {/* Send / Stop button embedded in the textarea corner */}
          {status === 'sending' ? (
            <button
              className="absolute bottom-4 right-4 text-xs px-2.5 py-1 rounded bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30"
              onClick={stop}
              title="Stop generation"
            >
              Stop
            </button>
          ) : (
            <button
              className="absolute bottom-4 right-4 text-xs px-2.5 py-1 rounded bg-[var(--color-accent)] text-white disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => void send()}
              disabled={!canSend}
              title="Send (Cmd/Ctrl+Enter)"
            >
              ➤
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
