import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { WorkerProfileStatusContactDeleterRepository } from './WorkerProfileStatusContactDeleter.repository';
import { WorkerProfileStatusDeleterRepository } from './WorkerProfileStatusDeleter.repository';

@injectable()
export class WorkerProfileStatusDeleterTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>,
    private readonly workerProfileStatusContactDeleterRepository: WorkerProfileStatusContactDeleterRepository,
    private readonly workerProfileStatusDeleterRepository: WorkerProfileStatusDeleterRepository
  ) {}

  deleteWorkerProfileStatus = async (
    workerProfileStatusId: string
  ): Promise<boolean> => {
    return this.db.transaction(async (tx) => {
      await this.workerProfileStatusContactDeleterRepository.deleteWorkerProfileStatusContactByStatusId(
        tx,
        workerProfileStatusId
      );

      const deleted =
        await this.workerProfileStatusDeleterRepository.deleteWorkerProfileStatus(
          tx,
          workerProfileStatusId
        );

      if (!deleted) {
        throw new Error('Failed to delete worker profile status');
      }

      return true;
    });
  };
}
