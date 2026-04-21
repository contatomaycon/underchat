import 'reflect-metadata';
import { WorkerProfileInfoUpserterRepository } from '@core/repositories/worker/WorkerProfileInfoUpserter.repository';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('WorkerProfileInfoUpserterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as jest.Mock).mockReturnValue('wpi-1');
  });

  it('creates profile info when no record exists', async () => {
    const insertExecute = jest.fn(async () => ({ rowCount: 1 }));
    const dbRw = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => [{ total: 0 }]),
          })),
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          execute: insertExecute,
        })),
      })),
      update: jest.fn(),
    };
    const repository = new WorkerProfileInfoUpserterRepository(dbRw as never);

    await expect(
      repository.upsertWorkerProfileInfo('w-1', {
        name: 'Worker Name',
        message: 'Hello',
      } as never)
    ).resolves.toBeUndefined();
    expect(insertExecute).toHaveBeenCalledTimes(1);
  });

  it('updates profile info when record exists and input has fields', async () => {
    const updateExecute = jest.fn(async () => ({ rowCount: 1 }));
    const dbRw = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => [{ total: 1 }]),
          })),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: updateExecute,
          })),
        })),
      })),
      insert: jest.fn(),
    };
    const repository = new WorkerProfileInfoUpserterRepository(dbRw as never);

    await expect(
      repository.upsertWorkerProfileInfo('w-1', {
        name: 'Updated Name',
      } as never)
    ).resolves.toBeUndefined();
    expect(updateExecute).toHaveBeenCalledTimes(1);
  });

  it('skips update when record exists but no editable field is provided', async () => {
    const dbRw = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => [{ total: 1 }]),
          })),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 1 })),
          })),
        })),
      })),
      insert: jest.fn(),
    };
    const repository = new WorkerProfileInfoUpserterRepository(dbRw as never);

    await expect(
      repository.upsertWorkerProfileInfo('w-1', {} as never)
    ).resolves.toBeUndefined();
    expect(dbRw.update).not.toHaveBeenCalled();
  });
});
