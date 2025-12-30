import * as schema from '@core/models';
import { user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class UserPasswordViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewUserPasswordById = async (
    userId: string,
    accountId: string
  ): Promise<string | null> => {
    const result = await this.dbRo
      .select({
        password: user.password,
      })
      .from(user)
      .where(
        and(
          eq(user.user_id, userId),
          eq(user.account_id, accountId),
          isNull(user.deleted_at)
        )
      )
      .execute();

    if (!result.length || !result[0]?.password) {
      return null;
    }

    return result[0].password;
  };
}
