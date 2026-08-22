import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import {
  AiProviderError,
  aiProviderClient,
  normalizeAiProviderBaseUrl,
  normalizeAiProviderConfiguration,
  normalizeAiProviderModel,
  resolveAiProviderKind,
  validateAiProviderConfiguration,
} from './aiProviderClient.service';

export interface AiAgentProviderConfigurationFields {
  ai_agent_type_id: string;
  base_url?: string | null;
  api_key?: string | null;
  model?: string | null;
  embedding_model?: string | null;
  status?: EAiAgentStatus | null;
}

export interface PreparedAiAgentProviderConfiguration {
  base_url: string | null;
  api_key: string | null;
  model: string | null;
  embedding_model: string | null;
}

/**
 * Canonicalizes provider fields and performs a real provider call before an
 * agent can be created or remain active. Active GPT and Gemini agents require
 * an embedding model; inactive drafts may stay incomplete.
 */
export const prepareAiAgentProviderConfiguration = async (
  input: AiAgentProviderConfigurationFields
): Promise<PreparedAiAgentProviderConfiguration> => {
  const provider = input.ai_agent_type_id;
  const providerKind = resolveAiProviderKind(provider);
  const configuredBaseUrl = input.base_url?.trim() || null;
  const baseUrl =
    input.status === EAiAgentStatus.inactive &&
    providerKind === 'others' &&
    !configuredBaseUrl
      ? null
      : normalizeAiProviderBaseUrl({
          provider,
          baseUrl: configuredBaseUrl,
        });
  const apiKey = input.api_key?.trim() || null;
  const model = input.model?.trim()
    ? normalizeAiProviderModel({ provider, model: input.model })
    : null;
  const embeddingModel = input.embedding_model?.trim()
    ? normalizeAiProviderModel({
        provider,
        model: input.embedding_model,
      })
    : null;

  if (input.status === EAiAgentStatus.inactive) {
    return {
      base_url: baseUrl,
      api_key: apiKey,
      model,
      embedding_model: embeddingModel,
    };
  }

  if (
    (providerKind === 'gpt' || providerKind === 'gemini') &&
    !embeddingModel
  ) {
    throw new AiProviderError({
      code: 'invalid_configuration',
      message:
        'O modelo de embedding é obrigatório para agentes GPT e Gemini ativos.',
      provider: providerKind,
    });
  }

  const normalized = normalizeAiProviderConfiguration({
    provider,
    baseUrl: baseUrl ?? '',
    apiKey: apiKey ?? '',
    model: model ?? '',
    embeddingModel,
  });

  await validateAiProviderConfiguration({
    configuration: normalized,
  });

  if (normalized.provider === 'gemini' && normalized.embeddingModel) {
    await aiProviderClient.generateGeminiEmbeddings({
      configuration: normalized,
      texts: ['UnderChat integration validation'],
    });
  } else if (normalized.embeddingModel) {
    await aiProviderClient.generateOpenAiCompatibleEmbeddings({
      configuration: normalized,
      texts: ['UnderChat integration validation'],
    });
  }

  return {
    base_url: normalized.baseUrl,
    api_key: normalized.apiKey,
    model: normalized.model,
    embedding_model: normalized.embeddingModel,
  };
};
