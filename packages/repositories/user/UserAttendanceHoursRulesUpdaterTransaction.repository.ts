import * as schema from '@core/models';
import { user, userAttendanceHoursRule } from '@core/models';
import { and, count, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { IUserAttendanceHoursRule } from '@core/common/interfaces/IUserAttendanceHours';

@injectable()
export class UserAttendanceHoursRulesUpdaterTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  replaceUserAttendanceHoursRules = async (
    userId: string,
    accountId: string,
    rules: IUserAttendanceHoursRule[]
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      const userResult = await tx
        .select({ total: count() })
        .from(user)
        .where(
          and(
            eq(user.user_id, userId),
            eq(user.account_id, accountId),
            isNull(user.deleted_at)
          )
        )
        .execute();

      if (!userResult.length || userResult[0].total === 0) {
        return false;
      }

      await tx
        .delete(userAttendanceHoursRule)
        .where(eq(userAttendanceHoursRule.user_id, userId))
        .execute();

      if (rules.length > 0) {
        await tx
          .insert(userAttendanceHoursRule)
          .values(
            rules.map((rule) => ({
              user_id: userId,
              weekday: rule.weekday,
              start_time: rule.start_time,
              end_time: rule.end_time,
            }))
          )
          .execute();
      }

      return true;
    });
  };
}
