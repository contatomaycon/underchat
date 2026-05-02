import { EChatStatus } from '../enums/EChatStatus';

interface ISummary {
  last_message: string | null;
  last_date: string | null;
  last_date_epoch_millis?: number | null;
  last_message_id?: string | null;
  last_processed_message_id?: string | null;
  operator_reply_pending_since?: string | null;
  unread_count: number;
}

interface IAccount {
  id: string;
  name: string;
}

interface IWorker {
  id: string;
  name: string;
}

interface ISector {
  id: string;
  name: string;
  color?: string;
}

interface IUser {
  id: string;
  name: string;
  photo?: string | null;
  entered_at?: string | null;
}

interface IContact {
  id: string;
  name: string;
  phone: string;
  phone_ddi?: string | null;
  photo?: string | null;
  responsible_attendant?: IUser | null;
  ignore?: string | null;
}

interface ILabel {
  label_template_id: string;
  label: string;
  color: string;
}

interface IMessageKey {
  remote_jid?: string | null;
  remote_jid_alt?: string | null;
}

export interface IChat {
  chat_id: string;
  message_key?: IMessageKey | null;
  summary?: ISummary | null;
  account: IAccount;
  worker: IWorker;
  sector?: ISector | null;
  user?: IUser | null;
  secondary_users?: IUser[] | null;
  contact?: IContact | null;
  photo?: string | null;
  name: string | null;
  phone: string;
  status: EChatStatus;
  date: string;
  started_at?: string | null;
  closed_at?: string | null;
  protocol_ura?: string[] | null;
  protocol_start?: string[] | null;
  protocol_transfer?: string[] | null;
  label?: ILabel[] | null;
  embedded_for_ai_agents?: string[] | null;
  forward_to_output_chatbot?: boolean | null;
  chatbot_schedule_id?: string | null;
  chatbot_webhook_id?: string | null;
}
