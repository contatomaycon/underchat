import 'reflect-metadata';
import { RandomMessageItemListerRepository } from '@core/repositories/randomMessage/RandomMessageItemLister.repository';

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

describe('RandomMessageItemListerRepository', () => {
  it('returns empty list when random message items are not found', async () => {
    const { dbRo } = createDbRoWithExecuteQueue([[]]);
    const repository = new RandomMessageItemListerRepository(dbRo as never);

    await expect(
      repository.listRandomMessageItems(10, 1, {} as never, 'rm-1', 'acc-1')
    ).resolves.toEqual([]);
  });

  it('returns listRandomMessageItems result', async () => {
    const rows = [
      {
        random_message_item_id: 'rmi-1',
        random_message_id: 'rm-1',
        message: 'Mensagem item',
        status: 'active',
        type: 'text',
        attachment_url: null,
        created_at: '2026-04-21T00:00:00.000Z',
      },
    ];
    const { dbRo } = createDbRoWithExecuteQueue([rows]);
    const repository = new RandomMessageItemListerRepository(dbRo as never);

    await expect(
      repository.listRandomMessageItems(
        10,
        1,
        {
          message: 'Mensagem',
          status: 'active',
          sort_by: [{ key: 'message', order: 'asc' }],
        } as never,
        'rm-1',
        'acc-1'
      )
    ).resolves.toEqual(rows);
  });

  it('returns item total count and fallback zero', async () => {
    const withCount = createDbRoWithExecuteQueue([[{ count: 4 }]]);
    const repositoryWithCount = new RandomMessageItemListerRepository(
      withCount.dbRo as never
    );

    await expect(
      repositoryWithCount.listRandomMessageItemTotal(
        {} as never,
        'rm-1',
        'acc-1'
      )
    ).resolves.toBe(4);

    const withoutCount = createDbRoWithExecuteQueue([[]]);
    const repositoryWithoutCount = new RandomMessageItemListerRepository(
      withoutCount.dbRo as never
    );

    await expect(
      repositoryWithoutCount.listRandomMessageItemTotal(
        {} as never,
        'rm-1',
        'acc-1'
      )
    ).resolves.toBe(0);
  });

  it('returns active items for runner and empty fallback', async () => {
    const rows = [
      {
        random_message_item_id: 'rmi-1',
        message: 'Mensagem item',
        type: 'text',
        attachment_url: null,
        mimetype: null,
        duration: null,
        width: null,
        height: null,
      },
    ];

    const withRows = createDbRoWithExecuteQueue([rows]);
    const repositoryWithRows = new RandomMessageItemListerRepository(
      withRows.dbRo as never
    );

    await expect(
      repositoryWithRows.listActiveRandomMessageItemsForRunner('rm-1', 'acc-1')
    ).resolves.toEqual(rows);

    const withoutRows = createDbRoWithExecuteQueue([[]]);
    const repositoryWithoutRows = new RandomMessageItemListerRepository(
      withoutRows.dbRo as never
    );

    await expect(
      repositoryWithoutRows.listActiveRandomMessageItemsForRunner(
        'rm-1',
        'acc-1'
      )
    ).resolves.toEqual([]);
  });
});
