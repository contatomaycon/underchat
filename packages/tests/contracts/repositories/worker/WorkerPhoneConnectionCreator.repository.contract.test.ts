import 'reflect-metadata';
import { WorkerPhoneConnectionCreatorRepository } from '@core/repositories/worker/WorkerPhoneConnectionCreator.repository';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('WorkerPhoneConnectionCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as jest.Mock).mockReturnValue('wpc-1');
  });

  it('returns true when insert affects one row', async () => {
    const values = jest.fn(() => ({
      execute: jest.fn(async () => ({ rowCount: 1 })),
    }));
    const repository = new WorkerPhoneConnectionCreatorRepository({
      insert: jest.fn(() => ({ values })),
    } as never);

    await expect(
      repository.createWorkerPhoneConnection({
        worker_id: 'w-1',
        number: '5511999999999',
        attempt: 1,
        attempt_date: '2026-04-21T10:00:00.000Z',
      })
    ).resolves.toBe(true);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_phone_connection_id: 'wpc-1',
      })
    );
  });

  it('returns false when insert affects zero rows', async () => {
    const repository = new WorkerPhoneConnectionCreatorRepository({
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 0 })),
        })),
      })),
    } as never);

    await expect(
      repository.createWorkerPhoneConnection({
        worker_id: 'w-1',
        number: '5511999999999',
        attempt: 1,
        attempt_date: '2026-04-21T10:00:00.000Z',
      })
    ).resolves.toBe(false);
  });
});
