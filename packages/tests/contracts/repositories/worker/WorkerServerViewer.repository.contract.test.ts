import 'reflect-metadata';
import { WorkerServerViewerRepository } from '@core/repositories/worker/WorkerServerViewer.repository';

function createDbMock(result: unknown[]) {
  const chain: {
    innerJoin: jest.Mock;
    leftJoin: jest.Mock;
    where: jest.Mock;
    groupBy: jest.Mock;
    having: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
    execute: jest.Mock;
  } = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    groupBy: jest.fn(),
    having: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    execute: jest.fn(async () => result),
  };

  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.groupBy.mockReturnValue(chain);
  chain.having.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);

  return {
    select: jest.fn(() => ({
      from: jest.fn(() => chain),
    })),
  };
}

describe('WorkerServerViewerRepository', () => {
  it('returns null when no server is available', async () => {
    const repository = new WorkerServerViewerRepository(
      createDbMock([]) as never
    );

    await expect(repository.viewWorkerServer('account-1')).resolves.toBeNull();
  });

  it('returns first available server payload', async () => {
    const row = {
      server_id: 'server-1',
      server_status_id: 'online',
      key: 'api-key',
      web_domain: 'example.com',
      web_port: 443,
      web_protocol: 'https',
      account_id: 'account-1',
    };
    const repository = new WorkerServerViewerRepository(
      createDbMock([row]) as never
    );

    await expect(repository.viewWorkerServer('account-1')).resolves.toEqual(
      row
    );
  });
});
