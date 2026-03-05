import * as schema from '@core/models';
import { user, userAttendanceHoursRule } from '@core/models';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { IUserAttendanceHoursRule } from '@core/common/interfaces/IUserAttendanceHours';

@injectable()
export class UserAttendanceHoursRulesViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listUserAttendanceHoursRules = async (
    userId: string,
    accountId: string
  ): Promise<IUserAttendanceHoursRule[]> => {
    const result = await this.dbRo
      .select({
        weekday: userAttendanceHoursRule.weekday,
        start_time: userAttendanceHoursRule.start_time,
        end_time: userAttendanceHoursRule.end_time,
      })
      .from(userAttendanceHoursRule)
      .innerJoin(user, eq(userAttendanceHoursRule.user_id, user.user_id))
      .where(
        and(
          eq(userAttendanceHoursRule.user_id, userId),
          eq(user.account_id, accountId),
          isNull(user.deleted_at)
        )
      )
      .execute();

    return result.map((item) => ({
      weekday: item.weekday as IUserAttendanceHoursRule['weekday'],
      start_time: item.start_time,
      end_time: item.end_time,
    }));
  };
}
