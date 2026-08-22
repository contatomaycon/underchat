import type {
  IPrepareSessionStorageMigrationRequestProto,
  IPrepareSessionStorageMigrationResponseProto,
} from '@core/common/interfaces/ISessionStorageMigrationPrepareProto';

/**
 * The public worker-command protobuf predates the provider-facing protobuf and
 * intentionally keeps its original wire field names. These adapters make that
 * boundary explicit so `legacy_volume_name`/`identity_hash_sha256` can never be
 * silently dropped by proto-loader while the application uses the canonical
 * `source_volume_name`/`identity_hash` names.
 */
export interface ICommandSessionStorageMigrationPrepareRequest {
  migration_id: string;
  worker_id: string;
  account_id: string;
  provider: string;
  runtime_generation: number;
  runtime_capability: string;
  legacy_volume_name: string;
  expected_phone?: string;
}

export interface ICommandSessionStorageMigrationPrepareResponse {
  migration_id: string;
  worker_id: string;
  provider: string;
  runtime_generation: number | string;
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
  identity_hash_sha256: string;
  prepared_at: string;
  error?: string;
}

export const sessionStorageMigrationPrepareToCommandProto = (
  input: IPrepareSessionStorageMigrationRequestProto
): ICommandSessionStorageMigrationPrepareRequest => ({
  migration_id: input.migration_id,
  worker_id: input.worker_id,
  account_id: input.account_id,
  provider: input.provider,
  runtime_generation: input.runtime_generation,
  runtime_capability: input.runtime_capability,
  legacy_volume_name: input.source_volume_name,
  ...(input.expected_phone ? { expected_phone: input.expected_phone } : {}),
});

export const commandProtoToSessionStorageMigrationPrepare = (
  input: ICommandSessionStorageMigrationPrepareRequest
): IPrepareSessionStorageMigrationRequestProto => ({
  migration_id: input.migration_id,
  worker_id: input.worker_id,
  account_id: input.account_id,
  provider:
    input.provider as IPrepareSessionStorageMigrationRequestProto['provider'],
  runtime_generation: Number(input.runtime_generation) || 0,
  runtime_capability: input.runtime_capability,
  source_volume_name: input.legacy_volume_name,
  ...(input.expected_phone ? { expected_phone: input.expected_phone } : {}),
});

export const sessionStorageMigrationResponseToCommandProto = (
  input: IPrepareSessionStorageMigrationResponseProto
): ICommandSessionStorageMigrationPrepareResponse => ({
  ...input,
  identity_hash_sha256: input.identity_hash,
});

export const commandProtoToSessionStorageMigrationResponse = (
  input: ICommandSessionStorageMigrationPrepareResponse
): IPrepareSessionStorageMigrationResponseProto => ({
  ...input,
  provider:
    input.provider as IPrepareSessionStorageMigrationResponseProto['provider'],
  runtime_generation: Number(input.runtime_generation) || 0,
  identity_hash: input.identity_hash_sha256,
});
