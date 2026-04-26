/**
 * Description: OpenAI-compatible chat client. Works against any server
 *   that implements the /chat/completions + /models routes — Ollama
 *   (>= 0.1.24), LM Studio, vLLM, OpenAI itself, DeepInfra, Groq,
 *   Together, OpenRouter, etc.
 *
 *   Kept minimal by design: fetch, SSE parsing, no SDK. Works inside
 *   the Tauri webview and in the isWeb mock build.
 */

import type { ChatMessage } from './types';

export interface OpenAIChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequestOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  onDelta?: (chunk: string) => void;
  signal?: AbortSignal;
  streaming?: boolean;
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path;
}

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export async function pingServer(
  baseUrl: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // `/models` is the cheapest well-defined route in the OpenAI spec.
  // Any 2xx counts; anything else is surfaced verbatim so the user can
  // see whether it's auth, CORS, or the server being down.
  try {
    const res = await fetch(joinUrl(baseUrl, '/models'), {
      signal,
      headers: authHeaders(apiKey),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    // A TypeError from fetch means the request never completed a round-trip
    // (DNS, refused, offline, CORS preflight). The default message
    // ("Failed to fetch" / "Load failed") doesn't tell the user what to check.
    const msg = (err as Error).message || '';
    if (err instanceof TypeError || /failed to fetch|load failed|networkerror/i.test(msg)) {
      return { ok: false, error: `Can't reach ${baseUrl} — check the URL is correct and the server is running` };
    }
    return { ok: false, error: msg };
  }
}

export async function listModels(
  baseUrl: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const res = await fetch(joinUrl(baseUrl, '/models'), {
    signal,
    headers: authHeaders(apiKey),
  });
  if (!res.ok) throw new Error(`list-models HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  return (body.data ?? []).map((m) => m.id).sort();
}

/**
 * Stream or batch a chat completion. Streaming uses the standard
 * OpenAI SSE format: `data: {json}\n\n` lines terminated by
 * `data: [DONE]`.
 */
export async function chat(opts: ChatRequestOptions): Promise<string> {
  const streaming = opts.streaming !== false;
  const res = await fetch(joinUrl(opts.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(opts.apiKey),
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: streaming,
      temperature: opts.temperature,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`chat HTTP ${res.status}: ${text || res.statusText}`);
  }

  if (!streaming) {
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return body.choices?.[0]?.message?.content ?? '';
  }

  if (!res.body) throw new Error('chat response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let assembled = '';

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const rawLine = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        const line = rawLine.trim();
        if (!line) continue;
        // SSE frames are `data: <payload>`. Tolerate servers that omit
        // the prefix (some Ollama versions do).
        const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
        if (payload === '[DONE]') return assembled;
        try {
          const obj = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string };
              message?: { content?: string };
              finish_reason?: string | null;
            }>;
            error?: { message?: string } | string;
          };
          if (obj.error) {
            const msg = typeof obj.error === 'string' ? obj.error : obj.error.message || 'stream error';
            throw new Error(msg);
          }
          const choice = obj.choices?.[0];
          const delta = choice?.delta?.content ?? choice?.message?.content ?? '';
          if (delta) {
            assembled += delta;
            opts.onDelta?.(delta);
          }
          if (choice?.finish_reason) return assembled;
        } catch (err) {
          console.warn('[ai-chat] bad stream frame:', payload, err);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return assembled;
}

export function toOpenAIMessages(messages: ChatMessage[]): OpenAIChatMessage[] {
  return messages
    .filter((m) => !m.pending && m.content.trim() !== '')
    .map((m) => ({ role: m.role as OpenAIChatMessage['role'], content: m.content }));
}
