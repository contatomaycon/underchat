import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { channelsConfigCentrifugo } from '@core/common/functions/centrifugoQueue';
import {
  SessionStorageMigrationRepository,
  toSessionStorageMigrationSummary,
} from '@core/repositories/config/SessionStorageMigration.repository';
import type { SessionStorageMigrationSummary } from '@core/schema/config/sessionStorageMigration/response.schema';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { sessionStorageMigrationTelemetryStore } from '@core/services/sessionStorageMigrationTelemetryStore';
import { inject, injectable } from 'tsyringe';

const REQUIRED_HEALTH_PROOFS = [
  'authenticated',
  'session_ready',
  'can_send',
  'can_receive_runtime',
  'native_connection_valid',
  'kafka_ready',
  'command_ingress_ready',
  'command_ingress_authorized',
  'phone_matches',
  'identity_matches',
] as const;

const sanitizeErrorCode = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/gu, '_')
    .slice(0, 100);
  return normalized || 'session_storage_migration_unknown_error';
};

@injectable()
export class SessionStorageMigrationService {
  constructor(
    @inject(SessionStorageMigrationRepository)
    private readonly repository: SessionStorageMigrationRepository,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClient: WorkerGrpcClientService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  private async publish(
    workerId: string,
    summary: SessionStorageMigrationSummary
  ): Promise<void> {
    await this.centrifugoService
      .publish(channelsConfigCentrifugo(), {
        action: 'session_storage_migration',
        worker_id: workerId,
        migration: summary,
      })
      .catch(() => undefined);
  }

  async publishSummary(
    workerId: string,
    summary: SessionStorageMigrationSummary
  ): Promise<void> {
    await this.publish(workerId, summary);
  }

  async start(workerId: string): Promise<SessionStorageMigrationSummary> {
    const candidate = await this.repository.viewCandidate(workerId);
    if (!candidate) {
      throw new Error('session_storage_migration_channel_unsupported');
    }
    if (
      candidate.worker_session_storage !==
        EWorkerSessionStorage.legacy_volume ||
      candidate.runtime_session_storage !== EWorkerSessionStorage.legacy_volume
    ) {
      const existing = await this.repository.latest(workerId);
      if (
        existing &&
        !['recovery_required', 'restored', 'completed'].includes(existing.state)
      ) {
        return toSessionStorageMigrationSummary(existing);
      }
      throw new Error('session_storage_migration_requires_legacy_volume');
    }

    const migration = await this.repository.createOrGetActive(candidate);
    sessionStorageMigrationTelemetryStore.recordTransition(
      migration.provider,
      migration.state
    );
    console.info('[SessionStorageMigration] migration_requested', {
      migration_id: migration.migration_id,
      provider: migration.provider,
      phase: migration.state,
      attempt: migration.attempt_count,
    });
    const summary = toSessionStorageMigrationSummary(migration);
    await this.publish(workerId, summary);
    return summary;
  }

  async latest(
    workerId: string
  ): Promise<SessionStorageMigrationSummary | null> {
    const migration = await this.repository.latest(workerId);
    return migration ? toSessionStorageMigrationSummary(migration) : null;
  }

  private targetHealthIsValid(
    fence: NonNullable<
      Awaited<ReturnType<SessionStorageMigrationRepository['viewCleanupFence']>>
    >
  ): boolean {
    const evidence = fence.migration.health_evidence;
    return (
      ['cleanup_pending', 'deleting_volume'].includes(fence.migration.state) &&
      fence.worker_session_storage === EWorkerSessionStorage.postgres &&
      fence.runtime_session_storage === EWorkerSessionStorage.postgres &&
      fence.session_state === 'ready' &&
      fence.session_provider === fence.migration.provider &&
      fence.active_revision_id === fence.migration.target_revision_id &&
      fence.runtime_generation === fence.migration.target_runtime_generation &&
      evidence.runtime_generation === fence.runtime_generation &&
      evidence.revision_id === fence.active_revision_id &&
      REQUIRED_HEALTH_PROOFS.every((proof) => evidence[proof] === true)
    );
  }

  async deleteLegacyVolume(
    workerId: string,
    migrationId: string
  ): Promise<SessionStorageMigrationSummary> {
    const initialFence = await this.repository.viewCleanupFence(
      workerId,
      migrationId
    );
    if (!initialFence) {
      throw new Error('session_storage_migration_not_found');
    }
    if (initialFence.migration.state === 'completed') {
      return toSessionStorageMigrationSummary(initialFence.migration);
    }
    if (!this.targetHealthIsValid(initialFence)) {
      throw new Error('session_storage_migration_target_health_invalid');
    }
    if (!initialFence.server_id) {
      throw new Error('session_storage_migration_target_server_invalid');
    }
    if (
      (await this.repository.countVolumeReferences(
        initialFence.migration.source_volume_name
      )) > 0
    ) {
      throw new Error('session_storage_migration_volume_still_referenced');
    }
    const health = await this.workerGrpcClient.runtimeHealth(
      initialFence.server_id,
      { worker_id: workerId },
      15_000
    );
    const native = health.connection_status;
    if (
      Number(health.runtime_health_schema_version ?? 0) < 4 ||
      health.session_storage !== EWorkerSessionStorage.postgres ||
      Number(health.session_revision_id) !==
        initialFence.migration.target_revision_id ||
      health.session_storage_migration_id ||
      Number(health.runtime_generation) !==
        initialFence.migration.target_runtime_generation ||
      health.authenticated !== true ||
      health.session_ready !== true ||
      health.can_send !== true ||
      health.can_receive_runtime !== true ||
      health.kafka_unhealthy === true ||
      health.kafka_consumers_ready !== true ||
      health.kafka_consumers_authorized !== true ||
      health.command_ingress_ready !== true ||
      health.command_ingress_authorized !== true ||
      native?.provider !== initialFence.migration.provider ||
      native.connected !== true ||
      native.authenticated !== true ||
      native.sessionValid !== true
    ) {
      throw new Error('session_storage_migration_live_health_invalid');
    }

    const deleting = await this.repository.transition(
      migrationId,
      null,
      ['cleanup_pending', 'deleting_volume'],
      'deleting_volume',
      {
        volume_delete_requested_at: new Date().toISOString(),
        last_error_code: null,
      }
    );
    if (!deleting) {
      throw new Error('session_storage_migration_cleanup_conflict');
    }

    try {
      const cleanupStartedAt = Date.now();
      const proof = await this.workerGrpcClient.deleteLegacySessionVolume(
        initialFence.server_id,
        {
          worker_id: workerId,
          account_id: deleting.account_id,
          migration_id: migrationId,
          volume_name: deleting.source_volume_name,
        }
      );
      if (
        proof.worker_id !== workerId ||
        proof.migration_id !== migrationId ||
        proof.volume_absent !== true ||
        proof.mounted_container_count !== 0
      ) {
        throw new Error('session_storage_migration_volume_delete_unconfirmed');
      }

      const completed = await this.repository.transition(
        migrationId,
        null,
        ['deleting_volume'],
        'completed',
        {
          source_volume_preserved: false,
          volume_deleted_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          health_evidence: {
            ...deleting.health_evidence,
            volume_absent: true,
          },
          last_error_code: null,
        }
      );
      if (!completed) {
        throw new Error('session_storage_migration_cleanup_commit_failed');
      }
      const summary = toSessionStorageMigrationSummary(completed);
      sessionStorageMigrationTelemetryStore.recordTransition(
        completed.provider,
        'completed'
      );
      sessionStorageMigrationTelemetryStore.recordCleanup(
        completed.provider,
        'succeeded'
      );
      console.info('[SessionStorageMigration] legacy_volume_deleted', {
        migration_id: completed.migration_id,
        provider: completed.provider,
        phase: completed.state,
        attempt: completed.attempt_count,
        duration_ms: Date.now() - cleanupStartedAt,
      });
      await this.publish(workerId, summary);
      return summary;
    } catch (error) {
      sessionStorageMigrationTelemetryStore.recordCleanup(
        deleting.provider,
        'failed'
      );
      console.warn('[SessionStorageMigration] legacy_volume_delete_failed', {
        migration_id: deleting.migration_id,
        provider: deleting.provider,
        phase: 'cleanup_pending',
        attempt: deleting.attempt_count,
        error_code: sanitizeErrorCode(error),
      });
      await this.repository.transition(
        migrationId,
        null,
        ['deleting_volume'],
        'cleanup_pending',
        { last_error_code: sanitizeErrorCode(error) }
      );
      throw error;
    }
  }
}

export { sanitizeErrorCode as sanitizeSessionStorageMigrationErrorCode };
