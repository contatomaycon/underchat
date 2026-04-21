import 'reflect-metadata';
import { WorkerUpdatedAtUpdaterRepository } from '@core/repositories/worker/WorkerUpdatedAtUpdater.repository';
import { currentTime } from '@core/common/functions/currentTime';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('WorkerUpdatedAtUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as jest.Mock).mockReturnValue('2026-04-21T10:00:00.000Z');
  });

  it('returns true when one row is updated', async () => {
    const repository = new WorkerUpdatedAtUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 1 })),
          })),
        })),
      })),
    } as never);

    await expect(repository.updateUpdatedAt('w-1')).resolves.toBe(true);
  });

  it('returns false when no row is updated', async () => {
    const repository = new WorkerUpdatedAtUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(repository.updateUpdatedAt('w-1')).resolves.toBe(false);
  });
});
