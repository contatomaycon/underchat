import 'reflect-metadata';
import { WorkerPhoneStatusConnectionDateUpdaterRepository } from '@core/repositories/worker/WorkerPhoneStatusConnectionDateUpdater.repository';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { currentTime } from '@core/common/functions/currentTime';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('WorkerPhoneStatusConnectionDateUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as jest.Mock).mockReturnValue('2026-04-21T10:00:00.000Z');
  });

  it('connectionDate returns null for disponible status or missing number', () => {
    const repository = new WorkerPhoneStatusConnectionDateUpdaterRepository(
      {} as never
    );

    expect(
      (repository as any).connectionDate({
        worker_id: 'w-1',
        number: '5511999999999',
        status: EWorkerStatus.disponible,
      })
    ).toBeNull();
    expect(
      (repository as any).connectionDate({
        worker_id: 'w-1',
        number: null,
        status: EWorkerStatus.online,
      })
    ).toBeNull();
  });

  it('connectionDate returns input connection date when provided', () => {
    const repository = new WorkerPhoneStatusConnectionDateUpdaterRepository(
      {} as never
    );

    expect(
      (repository as any).connectionDate({
        worker_id: 'w-1',
        number: '5511999999999',
        status: EWorkerStatus.online,
        connection_date: '2026-04-20T10:00:00.000Z',
      })
    ).toBe('2026-04-20T10:00:00.000Z');
  });

  it('updateWorkerPhoneStatusConnectionDate returns false when there is nothing to update', async () => {
    const repository = new WorkerPhoneStatusConnectionDateUpdaterRepository(
      {} as never
    );

    await expect(
      repository.updateWorkerPhoneStatusConnectionDate({
        worker_id: 'w-1',
        number: null,
      })
    ).resolves.toBe(false);
  });

  it('updates worker status and returns true when rowCount is one', async () => {
    const set = jest.fn(() => ({
      where: jest.fn(() => ({
        execute: jest.fn(async () => ({ rowCount: 1 })),
      })),
    }));
    const repository = new WorkerPhoneStatusConnectionDateUpdaterRepository({
      update: jest.fn(() => ({ set })),
    } as never);

    await expect(
      repository.updateWorkerPhoneStatusConnectionDate({
        worker_id: 'w-1',
        number: null,
        status: EWorkerStatus.disponible,
      })
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_status_id: EWorkerStatus.disponible,
        updated_at: '2026-04-21T10:00:00.000Z',
      })
    );
  });

  it('sets number and generated connection_date for non-disponible status', async () => {
    const set = jest.fn(() => ({
      where: jest.fn(() => ({
        execute: jest.fn(async () => ({ rowCount: 0 })),
      })),
    }));
    const repository = new WorkerPhoneStatusConnectionDateUpdaterRepository({
      update: jest.fn(() => ({ set })),
    } as never);

    await expect(
      repository.updateWorkerPhoneStatusConnectionDate({
        worker_id: 'w-1',
        number: '5511999999999',
        status: EWorkerStatus.online,
      })
    ).resolves.toBe(false);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        number: '5511999999999',
        connection_date: '2026-04-21T10:00:00.000Z',
      })
    );
  });
});
