import * as schema from '@core/models';
import { workerProfileInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { count, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { IUpdateWorkerProfileInfo } from '@core/common/interfaces/IUpdateWorkerProfileInfo';

@injectable()
export class WorkerProfileInfoUpserterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  upsertWorkerProfileInfo = async (
    workerId: string,
    input: IUpdateWorkerProfileInfo
  ): Promise<void> => {
    const exists = await this.findExistingProfileInfo(workerId);

    if (exists) {
      await this.updateProfileInfo(workerId, input);
      return;
    }

    await this.createProfileInfo(workerId, input);
  };

  private async findExistingProfileInfo(workerId: string): Promise<boolean> {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(workerProfileInfo)
      .where(eq(workerProfileInfo.worker_id, workerId))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  }

  private buildUpdateData(
    input: IUpdateWorkerProfileInfo
  ): Partial<typeof workerProfileInfo.$inferInsert> {
    const updateData: Partial<typeof workerProfileInfo.$inferInsert> = {
      updated_at: new Date().toISOString(),
    };

    if (input.name !== undefined) {
      updateData.name = input.name;
    }

    if (input.message !== undefined) {
      updateData.message = input.message;
    }

    if (input.photo !== undefined) {
      updateData.photo = input.photo;
    }

    return updateData;
  }

  private async updateProfileInfo(
    workerId: string,
    input: IUpdateWorkerProfileInfo
  ): Promise<void> {
    const updateData = this.buildUpdateData(input);

    if (Object.keys(updateData).length > 1) {
      await this.db
        .update(workerProfileInfo)
        .set(updateData)
        .where(eq(workerProfileInfo.worker_id, workerId))
        .execute();
    }
  }

  private async createProfileInfo(
    workerId: string,
    input: IUpdateWorkerProfileInfo
  ): Promise<void> {
    const workerProfileInfoId = this.generateProfileInfoId();

    await this.db
      .insert(workerProfileInfo)
      .values({
        worker_profile_info_id: workerProfileInfoId,
        worker_id: workerId,
        name: input.name ?? null,
        message: input.message ?? null,
        photo: input.photo ?? null,
      })
      .execute();
  }

  private generateProfileInfoId(): string {
    return uuidv7();
  }
}
