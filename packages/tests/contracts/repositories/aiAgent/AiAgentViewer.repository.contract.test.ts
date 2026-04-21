import 'reflect-metadata';
import { AiAgentViewerRepository } from '@core/repositories/aiAgent/AiAgentViewer.repository';

describe('AiAgentViewerRepository', () => {
  it('returns null when ai agent is not found', async () => {
    const dbRo = {
      query: {
        aiAgent: {
          findFirst: jest.fn(async () => null),
        },
      },
    };
    const repository = new AiAgentViewerRepository(dbRo as never);

    await expect(
      repository.viewAiAgent('agent-1', 'acc-1')
    ).resolves.toBeNull();
  });

  it('maps ai agent details and normalizes nullable/default fields', async () => {
    const dbRo = {
      query: {
        aiAgent: {
          findFirst: jest.fn(async () => ({
            ai_agent_id: 'agent-1',
            name: 'Agent',
            base_url: 'http://base',
            api_key: 'key',
            model: 'gpt',
            embedding_model: 'embed',
            chunk_size: '600',
            chunk_overlap: '100',
            openai_assistant_id: undefined,
            openai_vector_store_id: null,
            status: 'active',
            voice_ia_id: undefined,
            voice_ia_input_mode: null,
            voice_ia_output_mode: undefined,
            system_prompt: undefined,
            enable_human_transfer: undefined,
            enable_human_transfer_by_prompt: undefined,
            created_at: '2026-01-01',
            updated_at: '2026-01-02',
            aat: {
              ai_agent_type_id: 'gpt',
              name: 'GPT',
            },
          })),
        },
      },
    };
    const repository = new AiAgentViewerRepository(dbRo as never);

    await expect(repository.viewAiAgent('agent-1', 'acc-1')).resolves.toEqual({
      ai_agent_id: 'agent-1',
      name: 'Agent',
      base_url: 'http://base',
      api_key: 'key',
      model: 'gpt',
      embedding_model: 'embed',
      chunk_size: '600',
      chunk_overlap: '100',
      openai_assistant_id: null,
      openai_vector_store_id: null,
      status: 'active',
      voice_ia_id: null,
      voice_ia_input_mode: null,
      voice_ia_output_mode: null,
      system_prompt: null,
      enable_human_transfer: false,
      enable_human_transfer_by_prompt: false,
      ai_agent_type_id: 'gpt',
      ai_agent_type_name: 'GPT',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
  });
});
