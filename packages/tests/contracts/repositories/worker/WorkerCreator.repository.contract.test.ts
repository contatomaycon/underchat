import 'reflect-metadata';
import { WorkerCreatorRepository } from '@core/repositories/worker/WorkerCreator.repository';

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
        recreate_available_at: '2026-06-11T12:02:00.000Z',
      } as never)
    ).resolves.toBe(true);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        recreate_available_at: '2026-06-11T12:02:00.000Z',
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
      } as never)
    ).resolves.toBe(false);
  });
});
