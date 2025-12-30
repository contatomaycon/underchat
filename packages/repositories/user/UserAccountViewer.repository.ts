import * as schema from '@core/models';
import { user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class UserAccountViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  getUserAccountId = async (userId: string): Promise<string | null> => {
    const result = await this.dbRo
      .select({
        account_id: user.account_id,
      })
      .from(user)
      .where(and(eq(user.user_id, userId), isNull(user.deleted_at)))
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0].account_id;
  };
}
