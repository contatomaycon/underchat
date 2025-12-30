import * as schema from '@core/models';
import { user } from '@core/models';
import { and, count, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class UserTotalViewerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  totalUserByAccount = async (accountId: string): Promise<number> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(user)
      .where(and(eq(user.account_id, accountId), isNull(user.deleted_at)))
      .execute();

    if (!result.length) {
      return 0;
    }

    return result[0].total;
  };
}
