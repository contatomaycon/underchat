import { EAiAgentType } from '@core/common/enums/EAiAgentType';

export interface AiAgentModelOption {
  title: string;
  value: string;
}

export interface AiAgentProviderConfig {
  typeId: EAiAgentType;
  baseUrl: string;
  defaultChatModel: string;
  defaultEmbeddingModel: string;
  requiresEmbedding: boolean;
  lockBaseUrl: boolean;
  apiKeyUrl: string;
  chatModels: readonly AiAgentModelOption[];
  embeddingModels: readonly AiAgentModelOption[];
}

const toModelOptions = (models: readonly string[]): AiAgentModelOption[] =>
  models.map((model) => ({
    title: model,
    value: model,
  }));

export const AI_AGENT_PROVIDER_CATALOG: Readonly<
  Partial<Record<EAiAgentType, AiAgentProviderConfig>>
> = {
  [EAiAgentType.gpt]: {
    typeId: EAiAgentType.gpt,
    baseUrl: 'https://api.openai.com/v1',
    defaultChatModel: 'gpt-5.6',
    defaultEmbeddingModel: 'text-embedding-3-small',
    requiresEmbedding: true,
    lockBaseUrl: true,
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    chatModels: toModelOptions([
      'gpt-5.6',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.2',
      'gpt-5.1',
      'gpt-5',
      'gpt-5-mini',
      'gpt-5-nano',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
    ]),
    embeddingModels: toModelOptions([
      'text-embedding-3-small',
      'text-embedding-3-large',
      'text-embedding-ada-002',
    ]),
  },
  [EAiAgentType.gemini]: {
    typeId: EAiAgentType.gemini,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultChatModel: 'gemini-3.6-flash',
    defaultEmbeddingModel: 'gemini-embedding-2',
    requiresEmbedding: true,
    lockBaseUrl: true,
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    chatModels: toModelOptions(['gemini-3.6-flash', 'gemini-3.5-flash-lite']),
    embeddingModels: toModelOptions(['gemini-embedding-2']),
  },
  [EAiAgentType.deepseek]: {
    typeId: EAiAgentType.deepseek,
    baseUrl: 'https://api.deepseek.com',
    defaultChatModel: 'deepseek-v4-flash',
    defaultEmbeddingModel: '',
    requiresEmbedding: false,
    lockBaseUrl: true,
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    chatModels: toModelOptions(['deepseek-v4-flash', 'deepseek-v4-pro']),
    embeddingModels: [],
  },
};

export const getAiAgentProviderConfig = (
  typeId: string
): AiAgentProviderConfig | undefined =>
  AI_AGENT_PROVIDER_CATALOG[typeId as EAiAgentType];

export const isValidAiAgentBaseUrl = (value: string): boolean => {
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
};
