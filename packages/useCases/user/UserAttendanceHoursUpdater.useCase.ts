import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import {
  findConflictingUserAttendanceHoursRules,
  isUserAttendanceHoursRuleWindowValid,
  isUserAttendanceHoursWeekday,
  normalizeUserAttendanceHoursRules,
  USER_ATTENDANCE_HOURS_TIMEZONE,
} from '@core/common/functions/userAttendanceHours';
import { UpdateAttendanceHoursRequest } from '@core/schema/user/updateAttendanceHours/request.schema';
import { UpdateAttendanceHoursResponse } from '@core/schema/user/updateAttendanceHours/response.schema';

@injectable()
export class UserAttendanceHoursUpdaterUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService
  ) {}

  private async resolveTargetAccountId(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string,
    canOperateOnOthers: boolean
  ): Promise<string> {
    if (!canOperateOnOthers) {
      const existsUserById = await this.userService.existsUserById(
        userId,
        accountId
      );

      if (!existsUserById) {
        throw new Error(t('user_not_found'));
      }

      return accountId;
    }

    const userAccountId = await this.userService.getUserAccountId(userId);

    if (!userAccountId) {
      throw new Error(t('user_not_found'));
    }

    return userAccountId;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string,
    canOperateOnOthers: boolean,
    body: UpdateAttendanceHoursRequest
  ): Promise<UpdateAttendanceHoursResponse> {
    const targetAccountId = await this.resolveTargetAccountId(
      t,
      userId,
      accountId,
      canOperateOnOthers
    );

    const normalizedRules = normalizeUserAttendanceHoursRules(body.rules);

    for (const rule of normalizedRules) {
      if (!isUserAttendanceHoursWeekday(rule.weekday)) {
        throw new Error(t('user_attendance_hours_invalid_weekday'));
      }

      if (!isUserAttendanceHoursRuleWindowValid(rule)) {
        throw new Error(
          t('user_attendance_hours_invalid_time_range', {
            day: t(rule.weekday),
          })
        );
      }
    }

    const conflict = findConflictingUserAttendanceHoursRules(normalizedRules);

    if (conflict) {
      throw new Error(
        t('user_attendance_hours_rule_conflict', {
          day: t(conflict.first.weekday),
        })
      );
    }

    const updated = await this.userService.updateAttendanceHoursRules(
      userId,
      targetAccountId,
      normalizedRules
    );

    if (!updated) {
      throw new Error(t('user_not_found'));
    }

    return {
      user_id: userId,
      timezone: USER_ATTENDANCE_HOURS_TIMEZONE,
      enabled: normalizedRules.length > 0,
      rules: normalizedRules,
    };
  }
}
