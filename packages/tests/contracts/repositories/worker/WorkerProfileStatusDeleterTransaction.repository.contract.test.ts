import 'reflect-metadata';
import { WorkerProfileStatusDeleterTransactionRepository } from '@core/repositories/worker/WorkerProfileStatusDeleterTransaction.repository';

describe('WorkerProfileStatusDeleterTransactionRepository', () => {
  it('deletes contacts and status inside transaction', async () => {
    const deleteWorkerProfileStatusContactByStatusId = jest.fn(
      async () => true
    );
    const deleteWorkerProfileStatus = jest.fn(async () => true);
    const repository = new WorkerProfileStatusDeleterTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback({ tx: true })),
      } as never,
      {
        deleteWorkerProfileStatusContactByStatusId,
      } as never,
      {
        deleteWorkerProfileStatus,
      } as never
    );

    await expect(repository.deleteWorkerProfileStatus('wps-1')).resolves.toBe(
      true
    );
    expect(deleteWorkerProfileStatusContactByStatusId).toHaveBeenCalledTimes(1);
    expect(deleteWorkerProfileStatus).toHaveBeenCalledTimes(1);
  });

  it('throws when status delete fails', async () => {
    const repository = new WorkerProfileStatusDeleterTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback({})),
      } as never,
      {
        deleteWorkerProfileStatusContactByStatusId: jest.fn(async () => true),
      } as never,
      {
        deleteWorkerProfileStatus: jest.fn(async () => false),
      } as never
    );

    await expect(repository.deleteWorkerProfileStatus('wps-1')).rejects.toThrow(
      'Failed to delete worker profile status'
    );
  });
});
