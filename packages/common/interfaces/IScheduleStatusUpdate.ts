import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';

export interface IScheduleStatusUpdate {
  schedule_id: string;
  contact_id: string;
  message_id: string;
  status:
    | EScheduleStatus.sent
    | EScheduleStatus.failed
    | EScheduleStatus.ignored;
}
