import * as schema from '@core/models';
import { userStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { count, eq } from 'drizzle-orm';

@injectable()
export class UserStatusViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsUserStatusById = async (userStatusId: string): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(userStatus)
      .where(eq(userStatus.user_status_id, userStatusId))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
