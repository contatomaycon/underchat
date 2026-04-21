import 'reflect-metadata';
import { WorkerViewerRepository } from '@core/repositories/worker/WorkerViewer.repository';

function createDbMock(result: unknown[]) {
  const chain: {
    innerJoin: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  } = {
    innerJoin: jest.fn(),
    where: jest.fn(),
    execute: jest.fn(async () => result),
  };

  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);

  return {
    select: jest.fn(() => ({
      from: jest.fn(() => chain),
    })),
  };
}

describe('WorkerViewerRepository', () => {
  it('returns null when worker is not found', async () => {
    const repository = new WorkerViewerRepository(createDbMock([]) as never);

    await expect(repository.viewWorker('account-1', 'w-1')).resolves.toBeNull();
  });

  it('returns mapped worker payload when found', async () => {
    const row = {
      id: 'w-1',
      name: 'Worker 1',
      number: '5511999999999',
      status: { id: 'online', name: 'Online' },
      type: { id: 'wa', name: 'WhatsApp' },
      server: { id: 's-1', name: 'Server 1' },
      account: { id: 'a-1', name: 'Account 1' },
      connection_date: '2026-04-21T10:00:00.000Z',
      created_at: '2026-04-20T10:00:00.000Z',
      updated_at: '2026-04-21T10:00:00.000Z',
    };
    const repository = new WorkerViewerRepository(createDbMock([row]) as never);

    await expect(repository.viewWorker('account-1', 'w-1')).resolves.toEqual(
      row
    );
  });
});
