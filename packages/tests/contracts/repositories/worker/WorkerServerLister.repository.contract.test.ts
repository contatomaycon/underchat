import 'reflect-metadata';
import { WorkerServerListerRepository } from '@core/repositories/worker/WorkerServerLister.repository';

function createDbMock(result: unknown[]) {
  const chain: {
    innerJoin: jest.Mock;
    leftJoin: jest.Mock;
    where: jest.Mock;
    groupBy: jest.Mock;
    having: jest.Mock;
    orderBy: jest.Mock;
    execute: jest.Mock;
  } = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    groupBy: jest.fn(),
    having: jest.fn(),
    orderBy: jest.fn(),
    execute: jest.fn(async () => result),
  };

  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.groupBy.mockReturnValue(chain);
  chain.having.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);

  return {
    select: jest.fn(() => ({
      from: jest.fn(() => chain),
    })),
  };
}

describe('WorkerServerListerRepository', () => {
  it('returns empty list when there are no available servers', async () => {
    const repository = new WorkerServerListerRepository(
      createDbMock([]) as never
    );

    await expect(repository.listWorkerServers()).resolves.toEqual([]);
  });

  it('returns available worker servers list', async () => {
    const rows = [
      { server_id: 'server-1', name: 'Server 1' },
      { server_id: 'server-2', name: 'Server 2' },
    ];
    const repository = new WorkerServerListerRepository(
      createDbMock(rows) as never
    );

    await expect(repository.listWorkerServers()).resolves.toEqual(rows);
  });
});
