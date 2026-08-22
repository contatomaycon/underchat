import type { IMessageStatusUpdate } from './IMessageStatusUpdate';

export interface IMessageSendTerminalFailureRecovery {
  schema_version: 'message_send_terminal_failure_recovery_v1';
  provider: 'baileys' | 'wwebjs';
  operation_id: string;
  outcome_digest: string;
  status_update: IMessageStatusUpdate;
}
