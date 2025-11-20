import * as schema from '@core/models';
import { user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { count, eq, and, isNull } from 'drizzle-orm';

@injectable()
export class UserEmailViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsUserEmailById = async (userEmail: string): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(user)
      .where(and(eq(user.email_c, userEmail), isNull(user.deleted_at)))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
