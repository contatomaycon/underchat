import {
  commandProtoToSessionStorageMigrationPrepare,
  commandProtoToSessionStorageMigrationResponse,
  sessionStorageMigrationPrepareToCommandProto,
  sessionStorageMigrationResponseToCommandProto,
} from '@core/common/functions/sessionStorageMigrationCommandProtoMapper';

describe('session storage migration worker-command protobuf boundary', () => {
  it('preserves the legacy volume name across the command boundary', () => {
    const canonical = {
      migration_id: 'migration-1',
      worker_id: 'worker-1',
      account_id: 'account-1',
      provider: 'wwebjs' as const,
      source_volume_name: 'worker-1',
      runtime_generation: 9,
      runtime_capability: 'resolved_by_balance',
      expected_phone: '556192037138',
    };

    const wire = sessionStorageMigrationPrepareToCommandProto(canonical);

    expect(wire).toMatchObject({
      legacy_volume_name: canonical.source_volume_name,
    });
    expect(wire).not.toHaveProperty('source_volume_name');
    expect(commandProtoToSessionStorageMigrationPrepare(wire)).toEqual(
      canonical
    );
  });

  it('preserves the identity hash across the command boundary', () => {
    const canonical = {
      migration_id: 'migration-1',
      worker_id: 'worker-1',
      provider: 'wwebjs' as const,
      runtime_generation: 9,
      prepared: true,
      consumers_drained: true,
      writes_paused: true,
      checkpoint_persisted: true,
      provider_disconnected: true,
      volume_preserved: true,
      checkpoint_checksum_sha256: 'a'.repeat(64),
      checkpoint_size_bytes: 42,
      checkpoint_record_count: 3,
      phone: '556192037138',
      identity_hash: 'b'.repeat(64),
      prepared_at: '2026-08-15T04:00:00.000Z',
      error: '',
    };

    const wire = sessionStorageMigrationResponseToCommandProto(canonical);

    expect(wire.identity_hash_sha256).toBe(canonical.identity_hash);
    expect(commandProtoToSessionStorageMigrationResponse(wire)).toMatchObject(
      canonical
    );
  });
});
