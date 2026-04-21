import 'reflect-metadata';
import { WorkerDeleterRepository } from '@core/repositories/worker/WorkerDeleter.repository';
import { currentTime } from '@core/common/functions/currentTime';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('WorkerDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as jest.Mock).mockReturnValue('2026-04-21T10:00:00.000Z');
  });

  it('returns true when one worker is marked as deleted', async () => {
    const set = jest.fn(() => ({
      where: jest.fn(() => ({
        execute: jest.fn(async () => ({ rowCount: 1 })),
      })),
    }));
    const repository = new WorkerDeleterRepository({
      update: jest.fn(() => ({ set })),
    } as never);

    await expect(repository.deleteWorkerById('account-1', 'w-1')).resolves.toBe(
      true
    );
    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-04-21T10:00:00.000Z',
    });
  });

  it('returns false when no worker row is affected', async () => {
    const repository = new WorkerDeleterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(repository.deleteWorkerById('account-1', 'w-1')).resolves.toBe(
      false
    );
  });
});
