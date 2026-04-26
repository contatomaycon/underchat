import { AttendanceInactivityService } from '@core/services/attendanceInactivity.service';
import { injectable, inject } from 'tsyringe';
import { createI18nInstance } from '@core/common/functions/createI18nInstance';

export interface IAttendanceInactivityActivity {
  processScheduledInactivityChecks(): Promise<void>;
}

@injectable()
export class AttendanceInactivityActivity
  implements IAttendanceInactivityActivity
{
  constructor(
    @inject(AttendanceInactivityService)
    private readonly attendanceInactivityService: AttendanceInactivityService
  ) {}

  processScheduledInactivityChecks = async (): Promise<void> => {
    const t = await createI18nInstance('pt');

    await this.attendanceInactivityService.processScheduledInactivityChecks(t);
  };
}
