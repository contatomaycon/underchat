import 'reflect-metadata';
import { WorkerProfileStatusContactCreatorRepository } from '@core/repositories/worker/WorkerProfileStatusContactCreator.repository';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('WorkerProfileStatusContactCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as jest.Mock).mockReturnValue('wpsc-1');
  });

  it('returns generated id when insert result exists', async () => {
    const tx = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 1 })),
        })),
      })),
    } as never;
    const repository = new WorkerProfileStatusContactCreatorRepository(
      {} as never
    );

    await expect(
      repository.createWorkerProfileStatusContact(tx, 'wps-1', 'contact-1')
    ).resolves.toBe('wpsc-1');
  });

  it('returns null when insert result is null', async () => {
    const tx = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          execute: jest.fn(async () => null),
        })),
      })),
    } as never;
    const repository = new WorkerProfileStatusContactCreatorRepository(
      {} as never
    );

    await expect(
      repository.createWorkerProfileStatusContact(tx, 'wps-1', 'contact-1')
    ).resolves.toBeNull();
  });
});
