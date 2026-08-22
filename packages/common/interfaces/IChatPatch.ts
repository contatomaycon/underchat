import { EChatStatus } from '../enums/EChatStatus';
import { IOfficialWhatsappConversationWindowSnapshot } from './IOfficialWhatsappConversationWindow';

interface IAccount {
  id: string;
  name: string;
}

interface IWorker {
  id: string;
  name: string;
  type_id?: string | null;
  is_official?: boolean | null;
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

export interface ChatPatch {
  message_key?: IMessageKey | null;
  account?: IAccount;
  worker?: IWorker;
  sector?: ISector | null;
  user?: IUser | null;
  secondary_users?: IUser[] | null;
  contact?: IContact | null;
  photo?: string | null;
  name?: string | null;
  phone?: string;
  status?: EChatStatus;
  date?: string;
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
  chatbot_transfer_id?: string | null;
  official_window?: IOfficialWhatsappConversationWindowSnapshot | null;
}

export interface ChatPatchOptions {
  eventEpochMillis?: number;
  eventId?: string;
  statusSource?: string;
  allowCreate?: boolean;
  refresh?: boolean;
  expectedCurrentStatuses?: EChatStatus[];
  enforceExpectedStatusRevision?: boolean;
  enforceExpectedStartedAt?: boolean;
  enforceExpectedLastMessageId?: boolean;
  enforceExpectedSummaryRevision?: boolean;
  expectedStatusEventId?: string | null;
  expectedStatusEpoch?: number | null;
  expectedStartedAt?: string | null;
  expectedLastMessageId?: string | null;
  expectedSummaryRevision?: number | null;
  /** Also rejects a combined status/assignment patch when a newer assignment won. */
  enforceAssignmentRevision?: boolean;
  allowHumanToAutomation?: boolean;
  clearUnreadCount?: boolean;
  /** Internal mutation markers; never exposed in public webhook snapshots. */
  outboundWebhookEventIds?: readonly string[];
}
