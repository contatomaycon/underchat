import 'reflect-metadata';
import { WorkerListerRepository } from '@core/repositories/worker/WorkerLister.repository';

function createListWorkerSelect(result: unknown[]) {
  const chain: {
    innerJoin: jest.Mock;
    leftJoin: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
    offset: jest.Mock;
    execute: jest.Mock;
  } = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
    execute: jest.fn(async () => result),
  };

  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.offset.mockReturnValue(chain);

  return {
    from: jest.fn(() => chain),
  };
}

function createListWorkerTotalSelect(result: unknown[]) {
  const chain: {
    innerJoin: jest.Mock;
    leftJoin: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  } = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    execute: jest.fn(async () => result),
  };

  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);

  return {
    from: jest.fn(() => chain),
  };
}

describe('WorkerListerRepository', () => {
  it('setOrders returns default and custom order clauses', () => {
    const repository = new WorkerListerRepository({} as never);

    const defaultOrders = (repository as any).setOrders({} as never);
    const customOrders = (repository as any).setOrders({
      sort_by: [{ key: 'name', order: 'asc' }],
    } as never);

    expect(defaultOrders).toHaveLength(2);
    expect(customOrders).toHaveLength(1);
  });

  it('setFilters builds status/type/text filters', () => {
    const repository = new WorkerListerRepository({} as never);

    const filters = (repository as any).setFilters({
      name: 'Worker',
      number: '5511',
      server: 'Server',
      account: 'Account',
      status: 'online',
      type: 'baileys',
    } as never);

    expect(filters.length).toBeGreaterThanOrEqual(3);
  });

  it('listWorker returns empty array when query has no rows', async () => {
    const repository = new WorkerListerRepository({
      select: jest.fn(() => createListWorkerSelect([])),
    } as never);

    await expect(
      repository.listWorker('account-1', 10, 1, {} as never)
    ).resolves.toEqual([]);
  });

  it('listWorker maps worker rows', async () => {
    const repository = new WorkerListerRepository({
      select: jest.fn(() =>
        createListWorkerSelect([
          {
            id: 'w-1',
            name: 'Worker 1',
            number: '5511999999999',
            status: { id: 'online', name: 'Online' },
            type: { id: 'baileys', name: 'Baileys' },
            server: { id: 's-1', name: 'Server 1' },
            account: { id: 'a-1', name: 'Account 1' },
            connection_date: null,
            last_connection_check_at: null,
            recreate_available_at: '2026-06-11T12:02:00.000Z',
            created_at: '2026-04-20T10:00:00.000Z',
            updated_at: '2026-04-21T10:00:00.000Z',
          },
          {
            id: 'w-official',
            name: 'Official',
            number: '5561999990000',
            status: { id: 'online', name: 'Online' },
            type: { id: 'whatsapp', name: 'WhatsApp' },
            server: null,
            account: { id: 'a-1', name: 'Account 1' },
            connection_date: '2026-07-03T00:13:47.000Z',
            last_connection_check_at: null,
            recreate_available_at: null,
            created_at: '2026-07-02T23:39:59.000Z',
            updated_at: '2026-07-05T07:50:26.000Z',
          },
        ])
      ),
    } as never);

    await expect(
      repository.listWorker('account-1', 10, 1, {} as never)
    ).resolves.toEqual([
      {
        id: 'w-1',
        name: 'Worker 1',
        number: '5511999999999',
        status: { id: 'online', name: 'Online' },
        type: { id: 'baileys', name: 'Baileys' },
        server: { id: 's-1', name: 'Server 1' },
        account: { id: 'a-1', name: 'Account 1' },
        connection_date: null,
        last_connection_check_at: null,
        recreate_available_at: '2026-06-11T12:02:00.000Z',
        created_at: '2026-04-20T10:00:00.000Z',
        updated_at: '2026-04-21T10:00:00.000Z',
      },
      {
        id: 'w-official',
        name: 'Official',
        number: '5561999990000',
        status: { id: 'online', name: 'Online' },
        type: { id: 'whatsapp', name: 'WhatsApp' },
        server: null,
        account: { id: 'a-1', name: 'Account 1' },
        connection_date: '2026-07-03T00:13:47.000Z',
        last_connection_check_at: null,
        recreate_available_at: null,
        created_at: '2026-07-02T23:39:59.000Z',
        updated_at: '2026-07-05T07:50:26.000Z',
      },
    ]);
  });

  it('listWorkerTotal returns count and zero fallback', async () => {
    const repository = new WorkerListerRepository({
      select: jest.fn(() => createListWorkerTotalSelect([{ count: 5 }])),
    } as never);
    const repositoryZero = new WorkerListerRepository({
      select: jest.fn(() => createListWorkerTotalSelect([])),
    } as never);

    await expect(
      repository.listWorkerTotal('account-1', {} as never)
    ).resolves.toBe(5);
    await expect(
      repositoryZero.listWorkerTotal('account-1', {} as never)
    ).resolves.toBe(0);
  });
});
