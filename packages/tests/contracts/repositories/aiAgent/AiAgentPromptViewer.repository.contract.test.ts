import 'reflect-metadata';
import { AiAgentPromptViewerRepository } from '@core/repositories/aiAgent/AiAgentPromptViewer.repository';

describe('AiAgentPromptViewerRepository', () => {
  it('returns null when prompt is not found', async () => {
    const dbRo = {
      query: {
        aiAgentPrompt: {
          findFirst: jest.fn(async () => null),
        },
      },
    };
    const repository = new AiAgentPromptViewerRepository(dbRo as never);

    await expect(
      repository.viewAiAgentPrompt('prompt-1', 'acc-1')
    ).resolves.toBe(null);
  });

  it('returns null when account does not match', async () => {
    const dbRo = {
      query: {
        aiAgentPrompt: {
          findFirst: jest.fn(async () => ({ aag: { account_id: 'acc-2' } })),
        },
      },
    };
    const repository = new AiAgentPromptViewerRepository(dbRo as never);

    await expect(
      repository.viewAiAgentPrompt('prompt-1', 'acc-1')
    ).resolves.toBe(null);
  });

  it('maps prompt fields when account matches', async () => {
    const dbRo = {
      query: {
        aiAgentPrompt: {
          findFirst: jest.fn(async () => ({
            ai_agent_prompt_id: 'prompt-1',
            ai_agent_id: 'agent-1',
            value: 'hello',
            openai_file_id: undefined,
            status: 'active',
            created_at: '2026-01-01',
            updated_at: '2026-01-02',
            aag: { account_id: 'acc-1' },
          })),
        },
      },
    };
    const repository = new AiAgentPromptViewerRepository(dbRo as never);

    await expect(
      repository.viewAiAgentPrompt('prompt-1', 'acc-1')
    ).resolves.toEqual({
      ai_agent_prompt_id: 'prompt-1',
      ai_agent_id: 'agent-1',
      value: 'hello',
      openai_file_id: null,
      status: 'active',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
  });
});
