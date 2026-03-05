import { injectable, inject } from 'tsyringe';
import { UserService } from '@core/services/user.service';
import { TFunction } from 'i18next';
import { UserAttendanceGuardStatus } from '@core/schema/user/attendanceHours/shared.schema';

@injectable()
export class UserAttendanceHoursStatusViewerUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService
  ) {}

  async execute(
    _t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string
  ): Promise<UserAttendanceGuardStatus> {
    return this.userService.getAttendanceGuardStatus(userId, accountId);
  }
}
