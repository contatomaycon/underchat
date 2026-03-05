import { IUserAttendanceGuardStatus } from '@core/common/interfaces/IUserAttendanceHours';

export class UserAttendanceHoursBlockedError extends Error {
  public readonly attendanceGuard: IUserAttendanceGuardStatus;

  constructor(message: string, attendanceGuard: IUserAttendanceGuardStatus) {
    super(message);
    this.name = 'UserAttendanceHoursBlockedError';
    this.attendanceGuard = attendanceGuard;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UserAttendanceHoursBlockedError);
    }
  }
}
