import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { prepareAiAgentProviderConfiguration } from '@core/services/aiAgentProviderConfiguration.service';
import { aiProviderClient } from '@core/services/aiProviderClient.service';

describe('prepareAiAgentProviderConfiguration draft contracts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows an incomplete inactive custom-provider draft', async () => {
    await expect(
      prepareAiAgentProviderConfiguration({
        ai_agent_type_id: EAiAgentType.others,
        status: EAiAgentStatus.inactive,
      })
    ).resolves.toEqual({
      base_url: null,
      api_key: null,
      model: null,
      embedding_model: null,
    });
  });

  it('still validates a custom URL supplied on an inactive draft', async () => {
    await expect(
      prepareAiAgentProviderConfiguration({
        ai_agent_type_id: EAiAgentType.others,
        base_url: 'file:///etc/passwd',
        status: EAiAgentStatus.inactive,
      })
    ).rejects.toMatchObject({
      code: 'invalid_configuration',
    });
  });

  it('keeps canonical defaults for inactive built-in providers', async () => {
    await expect(
      prepareAiAgentProviderConfiguration({
        ai_agent_type_id: EAiAgentType.gemini,
        status: EAiAgentStatus.inactive,
      })
    ).resolves.toMatchObject({
      base_url: 'https://generativelanguage.googleapis.com/v1beta',
      api_key: null,
      model: null,
      embedding_model: null,
    });
  });

  it.each([
    {
      providerId: EAiAgentType.gpt,
      providerKind: 'gpt',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6',
    },
    {
      providerId: EAiAgentType.gemini,
      providerKind: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3.6-flash',
    },
  ] as const)(
    'rejects an active $providerKind agent without an embedding model',
    async ({ providerId, providerKind, baseUrl, model }) => {
      const validateSpy = jest.spyOn(aiProviderClient, 'validateConfiguration');

      await expect(
        prepareAiAgentProviderConfiguration({
          ai_agent_type_id: providerId,
          base_url: baseUrl,
          api_key: 'provider-key',
          model,
          embedding_model: '   ',
          status: EAiAgentStatus.active,
        })
      ).rejects.toMatchObject({
        code: 'invalid_configuration',
        provider: providerKind,
        message:
          'O modelo de embedding é obrigatório para agentes GPT e Gemini ativos.',
      });
      expect(validateSpy).not.toHaveBeenCalled();
    }
  );

  it('treats a missing status as active when validating required embeddings', async () => {
    await expect(
      prepareAiAgentProviderConfiguration({
        ai_agent_type_id: EAiAgentType.gpt,
        api_key: 'provider-key',
        model: 'gpt-5.6',
      })
    ).rejects.toMatchObject({
      code: 'invalid_configuration',
      provider: 'gpt',
    });
  });

  it('allows an active custom provider without an embedding model', async () => {
    const validateSpy = jest
      .spyOn(aiProviderClient, 'validateConfiguration')
      .mockResolvedValue({
        valid: true,
        provider: 'others',
        model: 'custom-chat-model',
        baseUrl: 'https://custom.example.test/v1',
        latencyMs: 1,
      });

    await expect(
      prepareAiAgentProviderConfiguration({
        ai_agent_type_id: EAiAgentType.others,
        base_url: 'https://custom.example.test/v1',
        api_key: 'provider-key',
        model: 'custom-chat-model',
        status: EAiAgentStatus.active,
      })
    ).resolves.toEqual({
      base_url: 'https://custom.example.test/v1',
      api_key: 'provider-key',
      model: 'custom-chat-model',
      embedding_model: null,
    });
    expect(validateSpy).toHaveBeenCalledTimes(1);
  });
});
