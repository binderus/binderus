/**
 * Description: Plugin-local types shared by panel / settings / client.
 *   The plugin speaks the OpenAI /chat/completions shape so it works
 *   against local Ollama (>= 0.1.24), LM Studio, OpenAI, DeepInfra,
 *   Groq, Together, OpenRouter, and any other OpenAI-compatible
 *   endpoint with a single code path.
 */

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  pending?: boolean;
}

export type ContextMode = 'editor' | 'selection' | 'files' | 'directory';

export type ProviderKey =
  | 'ollama'
  | 'openai'
  | 'deepinfra'
  | 'groq'
  | 'together'
  | 'openrouter'
  | 'lmstudio'
  | 'custom';

export interface ProviderPreset {
  key: ProviderKey;
  label: string;
  baseUrl: string;
  requiresApiKey: boolean;
  exampleModel: string;
  /** Link to help/docs the user can click to find model ids. */
  docsUrl?: string;
}

/**
 * Baseline list kept flat + hard-coded — no runtime fetch, no marketing
 * surface. If you want to add a provider, drop a row here and use the
 * "Custom" option for anything one-off.
 */
export const PROVIDERS: ProviderPreset[] = [
  {
    key: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    requiresApiKey: false,
    exampleModel: 'llama3.1:8b',
    docsUrl: 'https://ollama.com/library',
  },
  {
    key: 'lmstudio',
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    requiresApiKey: false,
    exampleModel: 'local-model',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    exampleModel: 'gpt-4o-mini',
    docsUrl: 'https://platform.openai.com/docs/models',
  },
  {
    key: 'deepinfra',
    label: 'DeepInfra',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    requiresApiKey: true,
    exampleModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    docsUrl: 'https://deepinfra.com/models',
  },
  {
    key: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    requiresApiKey: true,
    exampleModel: 'llama-3.1-8b-instant',
    docsUrl: 'https://console.groq.com/docs/models',
  },
  {
    key: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    requiresApiKey: true,
    exampleModel: 'meta-llama/Llama-3.1-8B-Instruct-Turbo',
    docsUrl: 'https://docs.together.ai/docs/inference-models',
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresApiKey: true,
    exampleModel: 'openai/gpt-4o-mini',
    docsUrl: 'https://openrouter.ai/models',
  },
  {
    key: 'custom',
    label: 'Custom endpoint',
    baseUrl: '',
    requiresApiKey: false,
    exampleModel: '',
  },
];

export interface AIChatPluginSettings extends Record<string, unknown> {
  provider: ProviderKey;
  /** OpenAI-compatible base URL. Should end in `/v1` or equivalent. */
  baseUrl: string;
  /** API key for the selected provider. Sent as `Authorization: Bearer <key>`. */
  apiKey: string;
  model: string;
  temperature: number;
  maxContextChars: number;
  systemPrompt: string;
  streaming: boolean;
}

export const DEFAULT_SETTINGS: AIChatPluginSettings = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  model: 'llama3.1:8b',
  temperature: 0.3,
  maxContextChars: 100_000,
  systemPrompt:
    'You are a concise, accurate writing and thinking partner. When given notes, answer based strictly on what is in them. Cite file paths when relevant.',
  streaming: true,
};
