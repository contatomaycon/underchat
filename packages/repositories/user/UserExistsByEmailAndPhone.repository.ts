import * as schema from '@core/models';
import { user, userInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm';

@injectable()
export class UserExistsByEmailAndPhoneRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsUserByEmail = async (
    emailC: string,
    excludeUserId?: string | null
  ): Promise<boolean> => {
    const conditions = [isNull(user.deleted_at), eq(user.email_c, emailC)];

    if (excludeUserId) {
      conditions.push(ne(user.user_id, excludeUserId));
    }

    const result = await this.db
      .select({
        total: count(),
      })
      .from(user)
      .where(and(...conditions))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };

  existsUserByPhone = async (
    phoneC: string,
    excludeUserId?: string | null
  ): Promise<boolean> => {
    const conditions = [
      isNull(user.deleted_at),
      inArray(
        user.user_id,
        this.db
          .select({ user_id: userInfo.user_id })
          .from(userInfo)
          .where(eq(userInfo.phone_c, phoneC))
      ),
    ];

    if (excludeUserId) {
      conditions.push(ne(user.user_id, excludeUserId));
    }

    const result = await this.db
      .select({
        total: count(),
      })
      .from(user)
      .where(and(...conditions))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
