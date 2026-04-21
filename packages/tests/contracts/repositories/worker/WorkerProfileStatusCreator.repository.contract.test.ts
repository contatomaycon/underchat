import 'reflect-metadata';
import { WorkerProfileStatusCreatorRepository } from '@core/repositories/worker/WorkerProfileStatusCreator.repository';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('WorkerProfileStatusCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as jest.Mock).mockReturnValue('wps-1');
  });

  it('returns generated id after insert', async () => {
    const tx = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 1 })),
        })),
      })),
    } as never;
    const repository = new WorkerProfileStatusCreatorRepository({} as never);

    await expect(
      repository.createWorkerProfileStatus(tx, {
        worker_id: 'w-1',
        worker_profile_status_type_id: 'type-1',
        value: 'hello',
        is_permanent: false,
      } as never)
    ).resolves.toBe('wps-1');
  });
});
