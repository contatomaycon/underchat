import { EScheduleType } from '@core/common/enums/EScheduleType';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';

export interface ScheduleDocument {
  id: string;
  schedule_id: string;
  attempt_id?: string | null;
  operational_state?:
    'pending' | 'pre_provider_failed' | 'ambiguous' | 'succeeded' | null;
  message_key: {
    remote_jid: string | null;
  };
  contact: {
    id: string;
    name: string;
    phone: string | null;
    phone_ddi: string | null;
    phone_partial: string | null;
  };
  account: {
    id: string;
    name: string;
  };
  worker: {
    id: string;
    name: string;
  };
  type: EScheduleType;
  message: string;
  url: string | null;
  chatbot_name?: string | null;
  status: EScheduleStatus | string;
  send_date: string;
  send_log: {
    result?: unknown;
    error?: string;
    success?: boolean;
    jid?: string;
    payload?: unknown;
  } | null;
  created_at: string;
  updated_at?: string;
  updated_at_epoch_millis?: number;
  last_event_id?: string | null;
  last_event_sort_key?: string | null;
  status_rank?: number | null;
}

export interface ScheduleCreateResult {
  created: boolean;
}

export interface SchedulePatchScriptParams extends Record<string, unknown> {
  patch: Partial<ScheduleDocument>;
}
