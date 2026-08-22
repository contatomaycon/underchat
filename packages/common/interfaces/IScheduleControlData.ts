import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';

export interface IScheduleControlData {
  schedule_id: string;
  account_id: string;
  worker_id: string;
  status: EScheduleStatus;
  send_date: string;
}
