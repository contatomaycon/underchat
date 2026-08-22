import type { WorkerWhatsappSessionProvider } from '@core/models';

export interface IPrepareSessionStorageMigrationRequestProto {
  worker_id: string;
  account_id: string;
  migration_id: string;
  provider: WorkerWhatsappSessionProvider;
  source_volume_name: string;
  runtime_generation: number;
  runtime_capability: string;
  expected_phone?: string;
  debug_trace_id?: string;
}

export interface IPrepareSessionStorageMigrationResponseProto {
  worker_id: string;
  provider: WorkerWhatsappSessionProvider;
  migration_id: string;
  runtime_generation: number;
  prepared: boolean;
  consumers_drained: boolean;
  writes_paused: boolean;
  checkpoint_persisted: boolean;
  provider_disconnected: boolean;
  volume_preserved: boolean;
  checkpoint_checksum_sha256: string;
  checkpoint_size_bytes: number | string;
  checkpoint_record_count: number | string;
  phone: string;
  identity_hash: string;
  prepared_at: string;
  error?: string;
}
