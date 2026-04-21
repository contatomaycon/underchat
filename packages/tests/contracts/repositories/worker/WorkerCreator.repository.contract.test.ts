import 'reflect-metadata';
import { WorkerCreatorRepository } from '@core/repositories/worker/WorkerCreator.repository';

describe('WorkerCreatorRepository', () => {
  it('returns true when insert affects one row', async () => {
    const repository = new WorkerCreatorRepository({
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 1 })),
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
    ).resolves.toBe(true);
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
