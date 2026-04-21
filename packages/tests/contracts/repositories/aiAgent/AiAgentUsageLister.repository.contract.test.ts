import 'reflect-metadata';
import { AiAgentUsageListerRepository } from '@core/repositories/aiAgent/AiAgentUsageLister.repository';

function createListChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const offset = jest.fn(() => ({ execute }));
  const limit = jest.fn(() => ({ offset }));
  const orderBy = jest.fn(() => ({ limit }));
  const where = jest.fn(() => ({ orderBy }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

function createCountChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('AiAgentUsageListerRepository', () => {
  it('returns empty list when agent does not exist', async () => {
    const dbRo = {
      query: {
        aiAgent: {
          findFirst: jest.fn(async () => null),
        },
      },
      select: jest.fn(),
    };
    const repository = new AiAgentUsageListerRepository(dbRo as never);

    await expect(
      repository.listByAiAgentId('agent-1', 'acc-1', 10, 1)
    ).resolves.toEqual([]);
  });

  it('maps usage list and normalizes nullable fields', async () => {
    const listChain = createListChain([
      {
        id: 1,
        prompt_tokens: undefined,
        completion_tokens: 20,
        total_tokens: 30,
        model: 'gpt-4o',
        latency_ms: null,
        success: true,
        created_at: '2026-01-01',
      },
    ]);
    const dbRo = {
      query: {
        aiAgent: {
          findFirst: jest.fn(async () => ({ ai_agent_id: 'agent-1' })),
        },
      },
      select: listChain.select,
    };
    const repository = new AiAgentUsageListerRepository(dbRo as never);

    await expect(
      repository.listByAiAgentId('agent-1', 'acc-1', 10, 1)
    ).resolves.toEqual([
      {
        id: 1,
        prompt_tokens: null,
        completion_tokens: 20,
        total_tokens: 30,
        model: 'gpt-4o',
        latency_ms: null,
        success: true,
        created_at: '2026-01-01',
      },
    ]);
  });

  it('returns zero in totalByAiAgentId when agent does not exist', async () => {
    const dbRo = {
      query: {
        aiAgent: {
          findFirst: jest.fn(async () => null),
        },
      },
      select: jest.fn(),
    };
    const repository = new AiAgentUsageListerRepository(dbRo as never);

    await expect(repository.totalByAiAgentId('agent-1', 'acc-1')).resolves.toBe(
      0
    );
  });

  it('returns usage total when agent exists', async () => {
    const countChain = createCountChain([{ count: 12 }]);
    const dbRo = {
      query: {
        aiAgent: {
          findFirst: jest.fn(async () => ({ ai_agent_id: 'agent-1' })),
        },
      },
      select: countChain.select,
    };
    const repository = new AiAgentUsageListerRepository(dbRo as never);

    await expect(repository.totalByAiAgentId('agent-1', 'acc-1')).resolves.toBe(
      12
    );
  });
});
