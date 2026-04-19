import * as schema from '@core/models';
import { release } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';
import { EditReleaseBodyRequest } from '@core/schema/release/editRelease/request.schema';
import { EReleaseType } from '@core/common/enums/EReleaseType';

@injectable()
export class ReleaseUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateById = async (
    releaseId: string,
    userId: string,
    input: EditReleaseBodyRequest
  ): Promise<true | 'not_found' | 'forbidden' | 'invalid_reminder'> => {
    const row = await this.fetchRowForUpdate(releaseId);
    if (!row) {
      return 'not_found';
    }

    if (row.created_by_user_id === null || row.created_by_user_id !== userId) {
      return 'forbidden';
    }

    const nextType = input.type ?? row.type;
    const nextReminder =
      input.reminder_at !== undefined ? input.reminder_at : row.reminder_at;

    if (nextType === EReleaseType.reminder && !nextReminder) {
      return 'invalid_reminder';
    }

    const updateData = this.buildUpdateData(input, row);
    const updated = await this.updateReleaseRecord(releaseId, updateData);

    return updated ? true : 'not_found';
  };

  private readonly fetchRowForUpdate = async (
    releaseId: string
  ): Promise<{
    created_by_user_id: string | null;
    type: EReleaseType;
    reminder_at: string | null;
  } | null> => {
    const [row] = await this.dbRw
      .select({
        created_by_user_id: release.created_by_user_id,
        type: release.type,
        reminder_at: release.reminder_at,
      })
      .from(release)
      .where(eq(release.release_id, releaseId))
      .limit(1)
      .execute();

    if (!row) {
      return null;
    }

    return {
      created_by_user_id: row.created_by_user_id,
      type: row.type as EReleaseType,
      reminder_at: row.reminder_at ?? null,
    };
  };

  private readonly buildUpdateData = (
    input: EditReleaseBodyRequest,
    currentRow: { type: EReleaseType; reminder_at: string | null }
  ): Partial<typeof release.$inferInsert> => {
    const updateData: Partial<typeof release.$inferInsert> = {
      updated_at: currentTime(),
    };

    const effectiveType = input.type ?? currentRow.type;

    if (input.type !== undefined) {
      updateData.type = input.type;
      if (input.type !== EReleaseType.reminder) {
        updateData.reminder_at = null;
      }
    }

    if (input.title !== undefined) {
      updateData.title = input.title;
    }

    if (input.message !== undefined) {
      updateData.message = input.message;
    }

    if (
      input.reminder_at !== undefined &&
      effectiveType === EReleaseType.reminder
    ) {
      updateData.reminder_at = input.reminder_at;
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
