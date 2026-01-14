import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';

export interface ScheduleStatusUpdateScriptParams extends Record<
  string,
  unknown
> {
  status: EScheduleStatus.sent | EScheduleStatus.failed;
  event_time_iso: string;
  event_time_epoch_millis: number;
  last_event_id: string;
}

export interface ScheduleDocumentBaseline extends Record<string, unknown> {
  status: EScheduleStatus.sent | EScheduleStatus.failed;
  updated_at: string;
  updated_at_epoch_millis: number;
  last_event_id: string;
}
