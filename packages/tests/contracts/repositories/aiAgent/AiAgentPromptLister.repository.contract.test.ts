import 'reflect-metadata';
import { AiAgentPromptListerRepository } from '@core/repositories/aiAgent/AiAgentPromptLister.repository';

describe('AiAgentPromptListerRepository', () => {
  it('returns empty array when ai agent does not exist', async () => {
    const dbRo = {
      query: {
        aiAgent: {
          findFirst: jest.fn(async () => null),
        },
        aiAgentPrompt: {
          findMany: jest.fn(),
        },
      },
    };
    const repository = new AiAgentPromptListerRepository(dbRo as never);

    await expect(
      repository.listAiAgentPrompts(
        { ai_agent_id: 'agent-1' } as never,
        'acc-1'
      )
    ).resolves.toEqual([]);
    expect(dbRo.query.aiAgentPrompt.findMany).not.toHaveBeenCalled();
  });

  it('maps prompt rows and normalizes nullable file id', async () => {
    const dbRo = {
      query: {
        aiAgent: {
          findFirst: jest.fn(async () => ({ ai_agent_id: 'agent-1' })),
        },
        aiAgentPrompt: {
          findMany: jest.fn(async () => [
            {
              ai_agent_prompt_id: 'prompt-1',
              ai_agent_id: 'agent-1',
              value: 'hello',
              openai_file_id: undefined,
              status: 'active',
              created_at: '2026-01-01',
              updated_at: '2026-01-02',
            },
          ]),
        },
      },
    };
    const repository = new AiAgentPromptListerRepository(dbRo as never);

    await expect(
      repository.listAiAgentPrompts(
        { ai_agent_id: 'agent-1' } as never,
        'acc-1'
      )
    ).resolves.toEqual([
      {
        ai_agent_prompt_id: 'prompt-1',
        ai_agent_id: 'agent-1',
        value: 'hello',
        openai_file_id: null,
        status: 'active',
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);
  });
});
