import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { EAiAgentVoiceInputMode } from '@core/common/enums/EAiAgentVoiceInputMode';
import { EAiAgentVoiceOutputMode } from '@core/common/enums/EAiAgentVoiceOutputMode';
import { AiAgentCreatorRepository } from '@core/repositories/aiAgent/AiAgentCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createRepository(insertResult: unknown = { rowCount: 1 }) {
  const execute = jest.fn(async () => insertResult);
  const values = jest.fn(() => ({ execute }));
  const insert = jest.fn(() => ({ values }));
  const dbRw = { insert };

  return {
    repository: new AiAgentCreatorRepository(dbRw as never),
    values,
  };
}

function createInput(
  overrides?: Record<string, unknown>
): Record<string, unknown> {
  return {
    ai_agent_type_id: EAiAgentType.gpt,
    name: 'Agent',
    base_url: null,
    api_key: 'api-key',
    model: 'model-1',
    embedding_model: 'embed-1',
    ...overrides,
  };
}

describe('AiAgentCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('ai-agent-id');
  });

  it('creates agent with defaults and GPT base URL', async () => {
    const { repository, values } = createRepository();

    const result = await repository.createAiAgent(
      createInput() as never,
      'acc-1'
    );

    expect(result).toBe('ai-agent-id');
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        ai_agent_id: 'ai-agent-id',
        account_id: 'acc-1',
        base_url: 'https://api.openai.com/v1',
        chunk_size: '600',
        chunk_overlap: '100',
        status: EAiAgentStatus.active,
        voice_ia_id: null,
        voice_ia_input_mode: null,
        voice_ia_output_mode: null,
        enable_human_transfer: false,
      })
    );
  });

  it('uses provided base URL and voice defaults when voice is set', async () => {
    const { repository, values } = createRepository();

    await repository.createAiAgent(
      createInput({
        ai_agent_type_id: EAiAgentType.gemini,
        base_url: 'https://custom-url',
        voice_ia_id: 'voice-1',
      }) as never,
      'acc-1'
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        base_url: 'https://custom-url',
        voice_ia_id: 'voice-1',
        voice_ia_input_mode: EAiAgentVoiceInputMode.audio_and_text,
        voice_ia_output_mode: EAiAgentVoiceOutputMode.audio,
      })
    );
  });

  it('uses deepseek default URL when base URL is empty', async () => {
    const { repository, values } = createRepository();

    await repository.createAiAgent(
      createInput({
        ai_agent_type_id: EAiAgentType.deepseek,
      }) as never,
      'acc-1'
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        base_url: 'https://api.deepseek.com/v1',
      })
    );
  });

  it('returns null when insert has no result', async () => {
    const { repository } = createRepository(null);

    await expect(
      repository.createAiAgent(createInput() as never, 'acc-1')
    ).resolves.toBeNull();
  });
});
