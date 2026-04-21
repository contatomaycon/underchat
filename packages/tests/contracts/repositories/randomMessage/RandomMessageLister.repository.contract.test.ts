import 'reflect-metadata';
import { RandomMessageListerRepository } from '@core/repositories/randomMessage/RandomMessageLister.repository';

function createDbRoWithExecuteQueue(queue: unknown[]) {
  const execute = jest.fn();
  for (const item of queue) {
    execute.mockResolvedValueOnce(item);
  }

  const chain = {} as {
    from: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
    offset: jest.Mock;
    execute: jest.Mock;
  };

  chain.from = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.orderBy = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.offset = jest.fn(() => chain);
  chain.execute = execute;

  return {
    dbRo: {
      select: jest.fn(() => chain),
    },
  };
}

describe('RandomMessageListerRepository', () => {
  it('returns empty list when random messages are not found', async () => {
    const { dbRo } = createDbRoWithExecuteQueue([[]]);
    const repository = new RandomMessageListerRepository(dbRo as never);

    await expect(
      repository.listRandomMessages(10, 1, {} as never, 'acc-1')
    ).resolves.toEqual([]);
  });

  it('returns listRandomMessages result', async () => {
    const rows = [
      {
        random_message_id: 'rm-1',
        name: 'Mensagem 1',
        status: 'active',
        created_at: '2026-04-21T00:00:00.000Z',
      },
    ];
    const { dbRo } = createDbRoWithExecuteQueue([rows]);
    const repository = new RandomMessageListerRepository(dbRo as never);

    await expect(
      repository.listRandomMessages(
        10,
        1,
        {
          name: 'Mensagem',
          status: 'active',
          sort_by: [{ key: 'name', order: 'asc' }],
        } as never,
        'acc-1'
      )
    ).resolves.toEqual(rows);
  });

  it('returns total count and fallback zero', async () => {
    const withCount = createDbRoWithExecuteQueue([[{ count: 3 }]]);
    const repositoryWithCount = new RandomMessageListerRepository(
      withCount.dbRo as never
    );

    await expect(
      repositoryWithCount.listRandomMessageTotal({} as never, 'acc-1')
    ).resolves.toBe(3);

    const withoutCount = createDbRoWithExecuteQueue([[]]);
    const repositoryWithoutCount = new RandomMessageListerRepository(
      withoutCount.dbRo as never
    );

    await expect(
      repositoryWithoutCount.listRandomMessageTotal({} as never, 'acc-1')
    ).resolves.toBe(0);
  });

  it('returns active random messages for chatbot', async () => {
    const rows = [{ random_message_id: 'rm-1', name: 'Mensagem 1' }];
    const { dbRo } = createDbRoWithExecuteQueue([rows]);
    const repository = new RandomMessageListerRepository(dbRo as never);

    await expect(
      repository.listActiveRandomMessagesForChatbot('acc-1')
    ).resolves.toEqual(rows);
  });

  it('returns empty list when active random messages query is empty', async () => {
    const { dbRo } = createDbRoWithExecuteQueue([[]]);
    const repository = new RandomMessageListerRepository(dbRo as never);

    await expect(
      repository.listActiveRandomMessagesForChatbot('acc-1')
    ).resolves.toEqual([]);
  });
});
