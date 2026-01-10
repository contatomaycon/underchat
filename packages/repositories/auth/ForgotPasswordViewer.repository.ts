import * as schema from '@core/models';
import { user, userInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { EUserStatus } from '@core/common/enums/EUserStatus';
import { IUserDataForForgotPassword } from '@core/common/interfaces/IUserDataForForgotPassword';

@injectable()
export class ForgotPasswordViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  findUserByEmailForForgotPassword = async (
    emailC: string
  ): Promise<IUserDataForForgotPassword | null> => {
    const result = await this.dbRo
      .select({
        user_id: user.user_id,
        account_id: user.account_id,
        email: user.email,
        phone: userInfo.phone,
        phone_ddi: userInfo.phone_ddi,
        name: userInfo.name,
      })
      .from(user)
      .innerJoin(userInfo, eq(userInfo.user_id, user.user_id))
      .where(
        and(
          eq(user.email_c, emailC),
          eq(user.user_status_id, EUserStatus.active),
          isNull(user.deleted_at),
          isNull(userInfo.deleted_at)
        )
      )
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return {
      user_id: result[0].user_id,
      account_id: result[0].account_id,
      email: result[0].email,
      phone: result[0].phone,
      phone_ddi: result[0].phone_ddi,
      name: result[0].name,
    };
  };
}
