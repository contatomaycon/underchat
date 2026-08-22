export type WhatsappProviderHandoffRecoveryTerminalState =
  'completed' | 'blocked' | 'cancelled';

/**
 * Durable recovery transition published only after its database transaction
 * commits. Consumers must still load the authoritative handoff/worker views;
 * these identities only fence that one event-driven reconciliation.
 */
export interface IWhatsappProviderHandoffRecoveryCentrifugo {
  event_type: 'whatsapp_provider_handoff_recovery_terminal';
  account_id: string;
  worker_id: string;
  handoff_id: string;
  handoff_lifecycle_operation_id: string;
  recovery_operation_id: string;
  recovery_state: WhatsappProviderHandoffRecoveryTerminalState;
  source_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  target_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
}
