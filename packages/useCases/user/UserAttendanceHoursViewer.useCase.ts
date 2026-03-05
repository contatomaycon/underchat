import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ViewAttendanceHoursResponse } from '@core/schema/user/viewAttendanceHours/response.schema';
import { USER_ATTENDANCE_HOURS_TIMEZONE } from '@core/common/functions/userAttendanceHours';

@injectable()
export class UserAttendanceHoursViewerUseCase {
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
    canOperateOnOthers: boolean
  ): Promise<ViewAttendanceHoursResponse> {
    const targetAccountId = await this.resolveTargetAccountId(
      t,
      userId,
      accountId,
      canOperateOnOthers
    );

    const rules = await this.userService.viewAttendanceHoursRules(
      userId,
      targetAccountId
    );

    return {
      user_id: userId,
      timezone: USER_ATTENDANCE_HOURS_TIMEZONE,
      enabled: rules.length > 0,
      rules,
    };
  }
}
