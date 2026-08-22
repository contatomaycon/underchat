export type WhatsappProviderHandoffProvider =
  'baileys' | 'whatsmeow' | 'wwebjs';

export interface WhatsappProviderHandoffRecoveryMarker {
  handoff_id: string;
  lifecycle_operation_id: string;
  source_provider: WhatsappProviderHandoffProvider;
  target_provider: WhatsappProviderHandoffProvider;
}

export type WhatsappProviderHandoffRecoveryState =
  | 'none'
  | 'pending'
  | 'dispatching'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'cancelled';

export type WhatsappProviderHandoffResolutionStatus =
  | 'in_progress'
  | 'completed'
  | 'restoring_source'
  | 'awaiting_decision'
  | 'rollback_blocked';

export interface WhatsappProviderHandoffView {
  worker_id: string;
  handoff_id: string;
  lifecycle_operation_id: string | null;
  handoff_lifecycle_operation_id: string | null;
  state: string;
  source_provider: WhatsappProviderHandoffProvider;
  target_provider: WhatsappProviderHandoffProvider;
  source_revision_id: string;
  target_revision_id: string | null;
  error_code: string | null;
  recovery_state: WhatsappProviderHandoffRecoveryState;
  recovery_operation_id: string | null;
  recovery_error_code: string | null;
  source_revision_preserved: boolean;
  source_runtime_restored: boolean;
  resolution_required: boolean;
  can_return: boolean;
  can_discard: boolean;
  resolution_status: WhatsappProviderHandoffResolutionStatus;
  resolution_action: WhatsappProviderHandoffAction | null;
  resolution_state: 'running' | 'completed' | null;
  resolution_operation_id: string | null;
  created_at: string;
  updated_at: string;
}

export type WhatsappProviderHandoffLookup =
  | { kind: 'found'; handoff: WhatsappProviderHandoffView }
  | { kind: 'not_found' }
  | { kind: 'unavailable' };

export type WhatsappProviderHandoffAction = 'discard' | 'return';

export interface WhatsappProviderHandoffResolution {
  action: WhatsappProviderHandoffAction;
  status: 'queued' | 'completed' | 'blocked';
  reason: string;
  handoff: WhatsappProviderHandoffView | null;
  operation_id?: string;
}

export interface WhatsappProviderHandoffRequestOptions {
  debugTraceId?: string;
  signal?: AbortSignal;
  silent?: boolean;
}
