import 'reflect-metadata';
import { WorkerProfileStatusDeleterRepository } from '@core/repositories/worker/WorkerProfileStatusDeleter.repository';

describe('WorkerProfileStatusDeleterRepository', () => {
  it('returns true when delete affects rows', async () => {
    const tx = {
      delete: jest.fn(() => ({
        where: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 1 })),
        })),
      })),
    } as never;
    const repository = new WorkerProfileStatusDeleterRepository({} as never);

    await expect(
      repository.deleteWorkerProfileStatus(tx, 'wps-1')
    ).resolves.toBe(true);
  });

  it('returns false when delete affects no rows', async () => {
    const tx = {
      delete: jest.fn(() => ({
        where: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 0 })),
        })),
      })),
    } as never;
    const repository = new WorkerProfileStatusDeleterRepository({} as never);

    await expect(
      repository.deleteWorkerProfileStatus(tx, 'wps-1')
    ).resolves.toBe(false);
  });
});
