export type WhatsappSessionProvider = 'baileys' | 'wwebjs' | 'whatsmeow';

export interface IPrepareProviderHandoffRequestProto {
  worker_id: string;
  account_id: string;
  handoff_id: string;
  lifecycle_operation_id: string;
  source_provider: WhatsappSessionProvider;
  target_provider: WhatsappSessionProvider;
  /** PostgreSQL bigint encoded as a decimal string by @grpc/proto-loader. */
  source_revision_id: string;
  runtime_generation: number;
  debug_trace_id?: string;
}

export interface IPrepareProviderHandoffResponseProto {
  worker_id: string;
  provider: WhatsappSessionProvider;
  handoff_id: string;
  lifecycle_operation_id: string;
  source_revision_id: string;
  runtime_generation: number;
  prepared: boolean;
  consumers_drained: boolean;
  writes_paused: boolean;
  checkpoint_persisted: boolean;
  provider_disconnected: boolean;
  lease_released: boolean;
  checkpoint_checksum_sha256: string;
  checkpoint_size_bytes: string;
  checkpoint_record_count: string;
  prepared_at: string;
  error: string;
}
