import 'reflect-metadata';
import { WorkerViewerRepository } from '@core/repositories/worker/WorkerViewer.repository';

function createDbMock(result: unknown[]) {
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
      recreate_available_at: '2026-06-11T12:02:00.000Z',
      created_at: '2026-04-20T10:00:00.000Z',
      updated_at: '2026-04-21T10:00:00.000Z',
    };
    const repository = new WorkerViewerRepository(createDbMock([row]) as never);

    await expect(repository.viewWorker('account-1', 'w-1')).resolves.toEqual(
      row
    );
  });

  it('returns official worker payload with null server', async () => {
    const row = {
      id: 'w-official',
      name: 'Official',
      number: '5561999990000',
      status: { id: 'online', name: 'Online' },
      type: { id: 'whatsapp', name: 'WhatsApp' },
      server: null,
      account: { id: 'a-1', name: 'Account 1' },
      connection_date: '2026-07-03T00:13:47.000Z',
      recreate_available_at: null,
      created_at: '2026-07-02T23:39:59.000Z',
      updated_at: '2026-07-05T07:50:26.000Z',
    };
    const repository = new WorkerViewerRepository(createDbMock([row]) as never);

    await expect(
      repository.viewWorker('account-1', 'w-official')
    ).resolves.toEqual(row);
  });
});
