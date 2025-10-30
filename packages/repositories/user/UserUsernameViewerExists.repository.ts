import * as schema from '@core/models';
import { user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { count, eq } from 'drizzle-orm';

@injectable()
export class UserUsernameViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsUsernameByUser = async (username: string): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(user)
      .where(eq(user.username, username))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
