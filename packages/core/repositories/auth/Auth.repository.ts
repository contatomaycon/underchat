import { EUserStatus } from '@core/common/enums/EUserStatus';
import * as schema from '@core/models';
import { user, userStatus } from '@core/models';
import { AuthLoginResponse } from '@core/schema/auth/login/response.schema';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class AuthRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  authenticate = async (
    login: string,
    password: string
  ): Promise<AuthLoginResponse | null> => {
    const result = await this.db
      .select({
        user_id: user.user_id,
      })
      .from(user)
      .innerJoin(userStatus, eq(userStatus.user_status_id, user.user_status_id))
      .where(
        and(
          eq(user.email, login),
          eq(user.password, password),
          eq(user.user_status_id, EUserStatus.active),
          isNull(user.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0] as AuthLoginResponse;
  };
}
