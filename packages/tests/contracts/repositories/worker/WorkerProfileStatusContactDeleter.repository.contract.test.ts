import 'reflect-metadata';
import { WorkerProfileStatusContactDeleterRepository } from '@core/repositories/worker/WorkerProfileStatusContactDeleter.repository';

describe('WorkerProfileStatusContactDeleterRepository', () => {
  it('returns true when delete affects rows', async () => {
    const tx = {
      delete: jest.fn(() => ({
        where: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 1 })),
        })),
      })),
    } as never;
    const repository = new WorkerProfileStatusContactDeleterRepository(
      {} as never
    );

    await expect(
      repository.deleteWorkerProfileStatusContactByStatusId(tx, 'wps-1')
    ).resolves.toBe(true);
  });

  it('returns false when delete affects zero rows', async () => {
    const tx = {
      delete: jest.fn(() => ({
        where: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 0 })),
        })),
      })),
    } as never;
    const repository = new WorkerProfileStatusContactDeleterRepository(
      {} as never
    );

    await expect(
      repository.deleteWorkerProfileStatusContactByStatusId(tx, 'wps-1')
    ).resolves.toBe(false);
  });
});
