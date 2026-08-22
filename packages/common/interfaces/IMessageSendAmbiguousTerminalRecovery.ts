import type { IMessageStatusUpdate } from './IMessageStatusUpdate';

export interface IMessageSendAmbiguousTerminalRecovery {
  schema_version: 'message_send_ambiguous_terminal_v1';
  provider: 'baileys' | 'wwebjs';
  operation_id: string;
  outcome_digest: string;
  status_update: IMessageStatusUpdate;
}
