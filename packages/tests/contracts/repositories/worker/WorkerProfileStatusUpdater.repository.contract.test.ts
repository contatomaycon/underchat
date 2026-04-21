import 'reflect-metadata';
import { WorkerProfileStatusUpdaterRepository } from '@core/repositories/worker/WorkerProfileStatusUpdater.repository';

describe('WorkerProfileStatusUpdaterRepository', () => {
  it('returns true when update affects one row', async () => {
    const repository = new WorkerProfileStatusUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 1 })),
          })),
        })),
      })),
    } as never);

    await expect(repository.updateIsPermanent('wps-1', true)).resolves.toBe(
      true
    );
  });

  it('returns false when update affects zero rows', async () => {
    const repository = new WorkerProfileStatusUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(repository.updateIsPermanent('wps-1', false)).resolves.toBe(
      false
    );
  });
});
