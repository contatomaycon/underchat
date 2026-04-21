import 'reflect-metadata';
import { WorkerProfileStatusExternalIdUpdaterRepository } from '@core/repositories/worker/WorkerProfileStatusExternalIdUpdater.repository';

describe('WorkerProfileStatusExternalIdUpdaterRepository', () => {
  it('returns true when update affects rows', async () => {
    const repository = new WorkerProfileStatusExternalIdUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 1 })),
          })),
        })),
      })),
    } as never);

    await expect(repository.updateExternalId('wps-1', 'ext-1')).resolves.toBe(
      true
    );
  });

  it('returns false when update affects no rows', async () => {
    const repository = new WorkerProfileStatusExternalIdUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(repository.updateExternalId('wps-1', 'ext-1')).resolves.toBe(
      false
    );
  });
});
