import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  workerLifecyclePhaseLineageFingerprint,
  workerLifecycleSemanticFingerprint,
} from '@core/common/functions/workerLifecycleSemanticFingerprint';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';

const payload = (): IWorkerLifecycleQueueMessage => ({
  request_id: 'request-1',
  operation_id: 'operation-1',
  action: 'recreate',
  worker_id: 'worker-1',
  account_id: 'account-1',
  server_id: 'server-1',
  worker_type_id: EWorkerType.wwebjs,
  session_storage: EWorkerSessionStorage.postgres,
  worker_status_id: EWorkerStatus.recreating,
  source: 'worker_update',
  remove_session: true,
  remove_volume: true,
  previous_worker_type_id: EWorkerType.baileys,
  requested_at: '2026-08-06T12:00:00.000Z',
});

describe('worker lifecycle semantic fingerprints', () => {
  it('makes legacy-to-PostgreSQL source storage immutable without changing ordinary command hashes', () => {
    const ordinary = payload();
    const explicitUndefined = {
      ...payload(),
      previous_session_storage: undefined,
    };
    const conversion = {
      ...payload(),
      previous_session_storage: EWorkerSessionStorage.legacy_volume,
    };

    expect(workerLifecycleSemanticFingerprint(explicitUndefined)).toBe(
      workerLifecycleSemanticFingerprint(ordinary)
    );
    expect(workerLifecyclePhaseLineageFingerprint(explicitUndefined)).toBe(
      workerLifecyclePhaseLineageFingerprint(ordinary)
    );
    expect(workerLifecycleSemanticFingerprint(conversion)).not.toBe(
      workerLifecycleSemanticFingerprint(ordinary)
    );
    expect(workerLifecyclePhaseLineageFingerprint(conversion)).not.toBe(
      workerLifecyclePhaseLineageFingerprint(ordinary)
    );
  });

  it('makes protected storage migration identity immutable without changing ordinary command hashes', () => {
    const ordinary = payload();
    const protectedMigration = {
      ...payload(),
      previous_session_storage: EWorkerSessionStorage.legacy_volume,
      session_storage_migration_id: '019ff000-0000-7000-8000-000000000001',
      legacy_session_volume_name: 'under-session-worker-1',
      legacy_session_checksum: 'a'.repeat(64),
    };
    const anotherMigration = {
      ...protectedMigration,
      session_storage_migration_id: '019ff000-0000-7000-8000-000000000002',
    };

    expect(workerLifecycleSemanticFingerprint(protectedMigration)).not.toBe(
      workerLifecycleSemanticFingerprint(ordinary)
    );
    expect(workerLifecycleSemanticFingerprint(anotherMigration)).not.toBe(
      workerLifecycleSemanticFingerprint(protectedMigration)
    );
    expect(workerLifecyclePhaseLineageFingerprint(anotherMigration)).not.toBe(
      workerLifecyclePhaseLineageFingerprint(protectedMigration)
    );
  });
});
