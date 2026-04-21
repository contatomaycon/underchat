import 'reflect-metadata';
import { WorkerStatusUpdaterRepository } from '@core/repositories/worker/WorkerStatusUpdater.repository';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { currentTime } from '@core/common/functions/currentTime';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('WorkerStatusUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as jest.Mock).mockReturnValue('2026-04-21T10:00:00.000Z');
  });

  it('includes connection fields when worker status is online', async () => {
    const set = jest.fn(() => ({
      where: jest.fn(() => ({
        execute: jest.fn(async () => ({ rowCount: 1 })),
      })),
    }));
    const repository = new WorkerStatusUpdaterRepository({
      update: jest.fn(() => ({ set })),
    } as never);

    await expect(
      repository.updateStatusWorker('w-1', EWorkerStatus.online)
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_status_id: EWorkerStatus.online,
        updated_at: '2026-04-21T10:00:00.000Z',
        last_connection_check_at: '2026-04-21T10:00:00.000Z',
        connection_date: '2026-04-21T10:00:00.000Z',
      })
    );
  });

  it('does not include connection fields when status is not online', async () => {
    const set = jest.fn(() => ({
      where: jest.fn(() => ({
        execute: jest.fn(async () => ({ rowCount: 0 })),
      })),
    }));
    const repository = new WorkerStatusUpdaterRepository({
      update: jest.fn(() => ({ set })),
    } as never);

    await expect(
      repository.updateStatusWorker('w-1', EWorkerStatus.disponible)
    ).resolves.toBe(false);

    expect(set).toHaveBeenCalledWith(
      expect.not.objectContaining({
        last_connection_check_at: expect.anything(),
      })
    );
  });
});
