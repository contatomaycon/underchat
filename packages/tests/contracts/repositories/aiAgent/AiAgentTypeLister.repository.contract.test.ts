import 'reflect-metadata';
import { AiAgentTypeListerRepository } from '@core/repositories/aiAgent/AiAgentTypeLister.repository';

describe('AiAgentTypeListerRepository', () => {
  it('returns empty array when query returns null', async () => {
    const dbRo = {
      query: {
        aiAgentType: {
          findMany: jest.fn(async () => null),
        },
      },
    };
    const repository = new AiAgentTypeListerRepository(dbRo as never);

    await expect(repository.listAiAgentTypes()).resolves.toEqual([]);
  });

  it('maps AI agent types', async () => {
    const dbRo = {
      query: {
        aiAgentType: {
          findMany: jest.fn(async () => [
            { ai_agent_type_id: 'gpt', name: 'GPT' },
          ]),
        },
      },
    };
    const repository = new AiAgentTypeListerRepository(dbRo as never);

    await expect(repository.listAiAgentTypes()).resolves.toEqual([
      { ai_agent_type_id: 'gpt', name: 'GPT' },
    ]);
  });
});
