import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { WhatsAppSourceProvider } from './IUpsertMessage';

export interface IScheduleStatusUpdate {
  /** Stable identity of schedule/contact/message/status. */
  event_id?: string;
  /** Unique operational identity for this delivery attempt. */
  attempt_id?: string;
  account_id?: string;
  worker_id?: string;
  source_provider?: WhatsAppSourceProvider;
  runtime_generation?: number | string;
  connection_epoch?: string;
  schedule_id: string;
  contact_id: string;
  message_id: string;
  processed_at?: string;
  status:
    EScheduleStatus.sent | EScheduleStatus.failed | EScheduleStatus.ignored;
}
