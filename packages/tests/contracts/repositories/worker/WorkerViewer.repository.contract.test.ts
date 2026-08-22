import 'reflect-metadata';
import { WorkerViewerRepository } from '@core/repositories/worker/WorkerViewer.repository';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

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
      session_storage: 'postgres',
      connection_date: '2026-04-21T10:00:00.000Z',
      recreate_available_at: '2026-06-11T12:02:00.000Z',
      lifecycle_operation_id: '019fd6f5-661d-742f-a306-97b77cde5232',
      created_at: '2026-04-20T10:00:00.000Z',
      updated_at: '2026-04-21T10:00:00.000Z',
    };
    const repository = new WorkerViewerRepository(createDbMock([row]) as never);

    await expect(repository.viewWorker('account-1', 'w-1')).resolves.toEqual({
      ...row,
      connection_status: null,
      connection_status_source_id: null,
      connection_status_order: null,
      connection_online_acknowledged: false,
    });
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
      session_storage: 'legacy_volume',
      connection_date: '2026-07-03T00:13:47.000Z',
      recreate_available_at: null,
      lifecycle_operation_id: null,
      created_at: '2026-07-02T23:39:59.000Z',
      updated_at: '2026-07-05T07:50:26.000Z',
    };
    const repository = new WorkerViewerRepository(createDbMock([row]) as never);

    await expect(
      repository.viewWorker('account-1', 'w-official')
    ).resolves.toEqual({
      ...row,
      connection_status: null,
      connection_status_source_id: null,
      connection_status_order: null,
      connection_online_acknowledged: false,
    });
  });

  it('returns the reload-safe connecting recreate phase without container ids', async () => {
    const row = {
      id: 'w-recreate',
      name: 'Recreate',
      number: null,
      status: { id: EWorkerStatus.recreating, name: 'recreating' },
      type: { id: EWorkerType.baileys, name: 'Baileys' },
      server: { id: 's-1', name: 'Server' },
      account: { id: 'a-1', name: 'Account' },
      session_storage: 'postgres',
      connection_date: null,
      recreate_available_at: null,
      lifecycle_operation_id: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
      created_at: '2026-08-07T11:00:00.000Z',
      updated_at: '2026-08-07T12:00:00.000Z',
      worker_container_id: 'b'.repeat(64),
      runtime_container_id: 'b'.repeat(64),
      runtime_generation: 6,
      recreate_bootstrap_operation_id: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
      recreate_bootstrap_runtime_generation: 6,
      recreate_bootstrap_container_id: 'b'.repeat(64),
      recreate_bootstrap_started_at: '2026-08-07T12:00:01.000Z',
    };
    const repository = new WorkerViewerRepository(createDbMock([row]) as never);

    const result = await repository.viewWorker('account-1', 'w-recreate');

    expect(result).toMatchObject({
      id: 'w-recreate',
      status: { id: EWorkerStatus.recreating },
      runtime_generation: 6,
      recreate_phase: 'connecting',
      recreate_phase_observed_at: '2026-08-07T12:00:01.000Z',
      recreate_runtime_retired: false,
    });
    expect(result).not.toHaveProperty('worker_container_id');
    expect(result).not.toHaveProperty('runtime_container_id');
  });
});
