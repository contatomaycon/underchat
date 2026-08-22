import 'reflect-metadata';
import { WorkerCreatorRepository } from '@core/repositories/worker/WorkerCreator.repository';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';

describe('WorkerCreatorRepository', () => {
  it('returns true when insert affects one row', async () => {
    const values = jest.fn(() => ({
      execute: jest.fn(async () => ({ rowCount: 1 })),
    }));
    const repository = new WorkerCreatorRepository({
      insert: jest.fn(() => ({
        values,
      })),
    } as never);

    await expect(
      repository.createWorker({
        worker_id: 'w-1',
        worker_status_id: 'status-1',
        worker_type_id: 'type-1',
        server_id: 'server-1',
        account_id: 'account-1',
        name: 'Worker 1',
        session_storage: EWorkerSessionStorage.postgres,
        lifecycle_operation_id: 'operation-1',
        recreate_available_at: '2026-06-11T12:02:00.000Z',
      })
    ).resolves.toBe(true);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle_operation_id: 'operation-1',
        recreate_available_at: '2026-06-11T12:02:00.000Z',
        session_storage: EWorkerSessionStorage.postgres,
      })
    );
  });

  it('returns false when insert affects zero rows', async () => {
    const repository = new WorkerCreatorRepository({
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 0 })),
        })),
      })),
    } as never);

    await expect(
      repository.createWorker({
        worker_id: 'w-1',
        worker_status_id: 'status-1',
        worker_type_id: 'type-1',
        server_id: 'server-1',
        account_id: 'account-1',
        name: 'Worker 1',
        session_storage: EWorkerSessionStorage.postgres,
        lifecycle_operation_id: 'operation-1',
      })
    ).resolves.toBe(false);
  });
});
