import 'reflect-metadata';
import { WorkerPhoneConnectionUpdaterRepository } from '@core/repositories/worker/WorkerPhoneConnectionUpdater.repository';

describe('WorkerPhoneConnectionUpdaterRepository', () => {
  it('returns true when update affects one row', async () => {
    const repository = new WorkerPhoneConnectionUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 1 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.updateWorkerPhoneConnection({
        worker_phone_connection_id: 'wpc-1',
        worker_id: 'w-1',
        number: '5511999999999',
        attempt: 2,
        attempt_date: '2026-04-21T11:00:00.000Z',
      })
    ).resolves.toBe(true);
  });

  it('returns false when update affects zero rows', async () => {
    const repository = new WorkerPhoneConnectionUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.updateWorkerPhoneConnection({
        worker_phone_connection_id: 'wpc-1',
        worker_id: 'w-1',
        number: '5511999999999',
        attempt: 2,
        attempt_date: '2026-04-21T11:00:00.000Z',
      })
    ).resolves.toBe(false);
  });
});
