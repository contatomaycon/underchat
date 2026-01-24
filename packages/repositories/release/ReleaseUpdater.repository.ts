import * as schema from '@core/models';
import { release } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';
import { EditReleaseBodyRequest } from '@core/schema/release/editRelease/request.schema';

@injectable()
export class ReleaseUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateById = async (
    releaseId: string,
    userId: string,
    input: EditReleaseBodyRequest
  ): Promise<true | 'not_found' | 'forbidden'> => {
    const validation = await this.validateCanUpdate(releaseId, userId);
    if (validation !== 'ok') {
      return validation;
    }

    const updateData = this.buildUpdateData(input);
    const updated = await this.updateReleaseRecord(releaseId, updateData);

    return updated ? true : 'not_found';
  };

  private readonly validateCanUpdate = async (
    releaseId: string,
    userId: string
  ): Promise<'not_found' | 'forbidden' | 'ok'> => {
    const [row] = await this.dbRw
      .select({ created_by_user_id: release.created_by_user_id })
      .from(release)
      .where(eq(release.release_id, releaseId))
      .limit(1)
      .execute();

    if (!row) {
      return 'not_found';
    }

    if (row.created_by_user_id === null || row.created_by_user_id !== userId) {
      return 'forbidden';
    }

    return 'ok';
  };

  private readonly buildUpdateData = (
    input: EditReleaseBodyRequest
  ): Partial<typeof release.$inferInsert> => {
    const updateData: Partial<typeof release.$inferInsert> = {
      updated_at: currentTime(),
    };

    if (input.type !== undefined) {
      updateData.type = input.type;
    }

    if (input.title !== undefined) {
      updateData.title = input.title;
    }

    if (input.message !== undefined) {
      updateData.message = input.message;
    }

    return updateData;
  };

  private readonly updateReleaseRecord = async (
    releaseId: string,
    updateData: Partial<typeof release.$inferInsert>
  ): Promise<boolean> => {
    const result = await this.dbRw
      .update(release)
      .set(updateData)
      .where(eq(release.release_id, releaseId))
      .execute();

    return result.rowCount === 1;
  };
}
