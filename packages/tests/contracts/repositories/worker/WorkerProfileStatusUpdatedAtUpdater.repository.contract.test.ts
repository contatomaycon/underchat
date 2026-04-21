import 'reflect-metadata';
import { WorkerProfileStatusUpdatedAtUpdaterRepository } from '@core/repositories/worker/WorkerProfileStatusUpdatedAtUpdater.repository';

describe('WorkerProfileStatusUpdatedAtUpdaterRepository', () => {
  it('returns true when one row is updated', async () => {
    const repository = new WorkerProfileStatusUpdatedAtUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 1 })),
          })),
        })),
      })),
    } as never);

    await expect(repository.updateUpdatedAt('wps-1')).resolves.toBe(true);
  });

  it('returns false when no row is updated', async () => {
    const repository = new WorkerProfileStatusUpdatedAtUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(repository.updateUpdatedAt('wps-1')).resolves.toBe(false);
  });
});
