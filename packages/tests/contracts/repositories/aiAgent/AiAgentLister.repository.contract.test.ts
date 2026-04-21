import 'reflect-metadata';
import { AiAgentListerRepository } from '@core/repositories/aiAgent/AiAgentLister.repository';

function createCountSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select, execute };
}

describe('AiAgentListerRepository', () => {
  it('maps listAiAgents result', async () => {
    const dbRo = {
      query: {
        aiAgent: {
          findMany: jest.fn(async () => [
            {
              ai_agent_id: 'a1',
              name: 'Agent 1',
              base_url: 'http://base',
              status: 'active',
              created_at: '2026-01-01',
              aat: { ai_agent_type_id: 'gpt', name: 'GPT' },
            },
          ]),
        },
      },
      select: jest.fn(),
    };
    const repository = new AiAgentListerRepository(dbRo as never);

    await expect(
      repository.listAiAgents(10, 1, {} as never, 'acc-1')
    ).resolves.toEqual([
      {
        ai_agent_id: 'a1',
        name: 'Agent 1',
        base_url: 'http://base',
        status: 'active',
        ai_agent_type_id: 'gpt',
        ai_agent_type_name: 'GPT',
        created_at: '2026-01-01',
      },
    ]);
  });

  it('returns empty list when listAiAgents receives null', async () => {
    const dbRo = {
      query: {
        aiAgent: {
          findMany: jest.fn(async () => null),
        },
      },
      select: jest.fn(),
    };
    const repository = new AiAgentListerRepository(dbRo as never);

    await expect(
      repository.listAiAgents(10, 1, {} as never, 'acc-1')
    ).resolves.toEqual([]);
  });

  it('returns count for listAiAgentsTotal and totalAiAgentByAccountId', async () => {
    const firstSelect = createCountSelectChain([{ count: 3 }]);
    const secondSelect = createCountSelectChain([{ total: 7 }]);
    const dbRo = {
      query: {
        aiAgent: {
          findMany: jest.fn(),
        },
      },
      select: jest
        .fn()
        .mockImplementationOnce(firstSelect.select)
        .mockImplementationOnce(secondSelect.select),
    };
    const repository = new AiAgentListerRepository(dbRo as never);

    await expect(
      repository.listAiAgentsTotal({} as never, 'acc-1')
    ).resolves.toBe(3);
    await expect(repository.totalAiAgentByAccountId('acc-1')).resolves.toBe(7);
  });

  it('lists active AI agents for chatbot', async () => {
    const dbRo = {
      query: {
        aiAgent: {
          findMany: jest.fn(async () => [
            { ai_agent_id: 'a1', name: 'Agent 1' },
            { ai_agent_id: 'a2', name: 'Agent 2' },
          ]),
        },
      },
      select: jest.fn(),
    };
    const repository = new AiAgentListerRepository(dbRo as never);

    await expect(
      repository.listActiveAiAgentsForChatbot('acc-1')
    ).resolves.toEqual([
      { ai_agent_id: 'a1', name: 'Agent 1' },
      { ai_agent_id: 'a2', name: 'Agent 2' },
    ]);
  });
});
