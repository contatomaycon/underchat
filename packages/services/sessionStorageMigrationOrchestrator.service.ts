import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { currentTime } from '@core/common/functions/currentTime';
import { workerLifecycleSemanticFingerprint } from '@core/common/functions/workerLifecycleSemanticFingerprint';
import { workerLifecycleBudgets } from '@core/common/functions/workerLifecycleBudgets';
import type { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import type { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import type { IWorkerRuntimeHealthResponseProto } from '@core/common/interfaces/IWorkerRuntimeActivationProto';
import type {
  WhatsappSessionStorageMigrationEvidence,
  WhatsappSessionStorageMigrationState,
} from '@core/models';
import {
  SessionStorageMigrationRepository,
  toSessionStorageMigrationSummary,
  type ClaimedSessionStorageMigration,
} from '@core/repositories/config/SessionStorageMigration.repository';
import { SessionStorageMigrationService } from '@core/services/sessionStorageMigration.service';
import { sessionStorageMigrationTelemetryStore } from '@core/services/sessionStorageMigrationTelemetryStore';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { createHash } from 'crypto';

const ATTEMPT_TIMEOUT_MS =
  workerLifecycleBudgets.sessionStorageMigrationAttemptMs;
const CLAIM_LEASE_SECONDS = Math.ceil(ATTEMPT_TIMEOUT_MS / 1_000) + 30;
const RETRY_BACKOFF_MS = [5_000, 15_000] as const;
const TARGET_VALIDATION_RECHECK_MS = 5_000;
const SOURCE_VOLUME_MISSING_ERROR =
  'session_storage_migration_source_volume_missing';
const TRANSIENT_TARGET_CONNECTION_STATUSES = new Set<string>([
  EWhatsappConnectionStatus.initializing,
  EWhatsappConnectionStatus.restoring,
  EWhatsappConnectionStatus.connecting,
  EWhatsappConnectionStatus.reconnecting,
  EWhatsappConnectionStatus.handoff,
]);
type SessionStorageMigrationMetadataScope = 'none' | 'identity' | 'full';

const providerForWorkerType = (workerType: string) =>
  workerType === EWorkerType.baileys
    ? 'baileys'
    : workerType === EWorkerType.wwebjs
      ? 'wwebjs'
      : workerType === EWorkerType.whatsmeow
        ? 'whatsmeow'
        : undefined;

const normalizePhone = (value: string | null | undefined): string =>
  (value ?? '').replace(/\D/gu, '');

const positiveInt = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const sanitizeError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/gu, '_')
    .slice(0, 100) || 'session_storage_migration_unknown_error';

@injectable()
export class SessionStorageMigrationOrchestratorService {
  constructor(
    @inject(SessionStorageMigrationRepository)
    private readonly repository: SessionStorageMigrationRepository,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClient: WorkerGrpcClientService,
    @inject(SessionStorageMigrationService)
    private readonly migrationService: SessionStorageMigrationService,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService
  ) {}

  private observeTransition(
    migration: ClaimedSessionStorageMigration,
    state: WhatsappSessionStorageMigrationState
  ) {
    sessionStorageMigrationTelemetryStore.recordTransition(
      migration.provider,
      state
    );
    console.info('[SessionStorageMigration] state_transition', {
      migration_id: migration.migration_id,
      provider: migration.provider,
      phase: state,
      attempt: migration.attempt_count,
    });
  }

  async processPending(): Promise<void> {
    for (let processed = 0; processed < 10; processed += 1) {
      const migration = await this.repository.claimNext(CLAIM_LEASE_SECONDS);
      if (!migration) return;
      try {
        await this.process(migration);
      } catch (error) {
        await this.handleFailure(migration, error);
      }
    }
  }

  private async transition(
    migration: ClaimedSessionStorageMigration,
    expected: WhatsappSessionStorageMigrationState[],
    state: WhatsappSessionStorageMigrationState,
    patch: Parameters<SessionStorageMigrationRepository['transition']>[4] = {},
    requireClaim = true
  ) {
    const updated = await this.repository.transition(
      migration.migration_id,
      requireClaim ? migration.claim_token : null,
      expected,
      state,
      patch
    );
    if (updated) {
      this.observeTransition(updated as ClaimedSessionStorageMigration, state);
      if (state === 'cleanup_pending' && updated.attempt_started_at) {
        sessionStorageMigrationTelemetryStore.recordAttemptDuration(
          updated.provider,
          Date.now() - Date.parse(updated.attempt_started_at)
        );
      }
      await this.migrationService.publishSummary(
        migration.worker_id,
        toSessionStorageMigrationSummary(updated)
      );
    }
    return updated;
  }

  private async process(migration: ClaimedSessionStorageMigration) {
    switch (migration.state) {
      case 'queued':
        await this.beginAttempt(migration, false);
        return;
      case 'retry_wait':
        await this.beginAttempt(
          migration,
          Boolean(migration.checkpoint_checksum)
        );
        return;
      case 'capturing':
        await this.capture(migration);
        return;
      case 'staged':
        await this.cutover(migration);
        return;
      case 'cutting_over':
        await this.invokeLifecycle(migration, 'full');
        return;
      case 'starting':
        await this.transition(migration, ['starting'], 'validating');
        return;
      case 'validating':
        await this.validateTarget(migration);
        return;
      case 'restoring':
        await this.restore(migration);
        return;
      default:
        return;
    }
  }

  private async beginAttempt(
    migration: ClaimedSessionStorageMigration,
    reuseCheckpoint: boolean
  ) {
    const attempt = migration.attempt_count + 1;
    if (attempt > 3) {
      await this.transition(migration, [migration.state], 'restoring', {
        next_attempt_at: new Date().toISOString(),
      });
      return;
    }
    const now = Date.now();
    const updated = await this.transition(
      migration,
      [migration.state],
      reuseCheckpoint ? 'staged' : 'capturing',
      {
        attempt_count: attempt,
        attempt_started_at: new Date(now).toISOString(),
        attempt_deadline_at: new Date(now + ATTEMPT_TIMEOUT_MS).toISOString(),
        // `next_attempt_at` controls when the next phase may be claimed. The
        // attempt deadline is an independent watchdog. Delaying `capturing`
        // until that deadline makes the RPC impossible to execute: the claim
        // is first acquired only after the attempt has already expired.
        next_attempt_at: new Date(now).toISOString(),
        last_error_code: null,
      }
    );
    if (updated) {
      sessionStorageMigrationTelemetryStore.recordAttempt(
        updated.provider,
        attempt
      );
    }
  }

  private async capture(migration: ClaimedSessionStorageMigration) {
    this.assertAttemptDeadline(migration);
    if (
      !migration.server_id ||
      !providerForWorkerType(migration.worker_type_id)
    ) {
      throw new Error('session_storage_migration_source_server_invalid');
    }
    const response = await this.workerGrpcClient.prepareSessionStorageMigration(
      migration.server_id,
      {
        worker_id: migration.worker_id,
        account_id: migration.account_id,
        migration_id: migration.migration_id,
        provider: migration.provider,
        source_volume_name: migration.source_volume_name,
        runtime_generation: migration.source_runtime_generation,
        runtime_capability: 'resolved_by_balance',
        expected_phone: migration.expected_phone ?? undefined,
      }
    );
    const size = positiveInt(response.checkpoint_size_bytes);
    const records = positiveInt(response.checkpoint_record_count);
    if (
      response.migration_id !== migration.migration_id ||
      response.worker_id !== migration.worker_id ||
      response.provider !== migration.provider ||
      response.runtime_generation !== migration.source_runtime_generation ||
      response.prepared !== true ||
      response.consumers_drained !== true ||
      response.writes_paused !== true ||
      response.checkpoint_persisted !== true ||
      response.provider_disconnected !== true ||
      response.volume_preserved !== true ||
      !/^[0-9a-f]{64}$/u.test(response.checkpoint_checksum_sha256) ||
      !/^[0-9a-f]{64}$/u.test(response.identity_hash) ||
      !size ||
      !records ||
      (migration.expected_phone &&
        normalizePhone(response.phone) !==
          normalizePhone(migration.expected_phone))
    ) {
      throw new Error('session_storage_migration_checkpoint_proof_invalid');
    }
    await this.transition(migration, ['capturing'], 'staged', {
      checkpoint_checksum: response.checkpoint_checksum_sha256,
      checkpoint_size_bytes: size,
      checkpoint_record_count: records,
      expected_identity_hash: response.identity_hash,
      source_volume_preserved: true,
      next_attempt_at: new Date().toISOString(),
    });
  }

  private async cutover(migration: ClaimedSessionStorageMigration) {
    this.assertAttemptDeadline(migration);
    if (!migration.checkpoint_checksum || !migration.server_id) {
      throw new Error('session_storage_migration_checkpoint_missing');
    }
    const lifecycleOperationId = uuidv7();
    const targetGeneration = migration.runtime_generation + 1;
    const lifecyclePayload = await this.prepareLifecyclePayload(migration, {
      lifecycleOperationId,
      targetStorage: EWorkerSessionStorage.postgres,
      // A retry re-enters through `staged` with a new operation id, but the
      // first attempt may already have changed the live runtime view to
      // PostgreSQL. The protected migration direction remains immutable.
      previousStorage: EWorkerSessionStorage.legacy_volume,
      migrationMetadataScope: 'full',
    });
    const begun = await this.repository.beginLifecycle({
      migrationId: migration.migration_id,
      claimToken: migration.claim_token ?? '',
      expectedStates: ['staged'],
      state: 'cutting_over',
      targetStorage: EWorkerSessionStorage.postgres,
      targetRuntimeGeneration: targetGeneration,
      lifecycleOperationId,
    });
    if (!begun) return;
    this.observeTransition(
      begun as ClaimedSessionStorageMigration,
      'cutting_over'
    );
    await this.migrationService.publishSummary(
      migration.worker_id,
      toSessionStorageMigrationSummary(begun)
    );
    await this.workerGrpcClient.recreateWorker(
      lifecyclePayload,
      ATTEMPT_TIMEOUT_MS
    );
    const updated = await this.repository.transition(
      migration.migration_id,
      null,
      ['cutting_over'],
      'starting',
      { next_attempt_at: new Date().toISOString() }
    );
    if (updated) {
      this.observeTransition(
        updated as ClaimedSessionStorageMigration,
        'starting'
      );
      await this.migrationService.publishSummary(
        migration.worker_id,
        toSessionStorageMigrationSummary(updated)
      );
    }
  }

  private async invokeLifecycle(
    migration: ClaimedSessionStorageMigration,
    migrationMetadataScope: SessionStorageMigrationMetadataScope
  ) {
    this.assertAttemptDeadline(migration);
    if (!migration.lifecycle_operation_id || !migration.server_id) {
      throw new Error('session_storage_migration_lifecycle_missing');
    }
    const lifecyclePayload = await this.prepareLifecyclePayload(migration, {
      lifecycleOperationId: migration.lifecycle_operation_id,
      targetStorage: EWorkerSessionStorage.postgres,
      // `cutting_over` may be reclaimed after the first lifecycle command has
      // already changed the live worker/runtime view to PostgreSQL. The
      // durable operation is still the same protected legacy-volume ->
      // PostgreSQL transition. Preserve that immutable source on every
      // redrive instead of rebuilding it from a partially promoted runtime.
      previousStorage: EWorkerSessionStorage.legacy_volume,
      migrationMetadataScope,
    });
    await this.workerGrpcClient.recreateWorker(
      lifecyclePayload,
      ATTEMPT_TIMEOUT_MS
    );
    await this.transition(migration, ['cutting_over'], 'starting', {
      next_attempt_at: new Date().toISOString(),
    });
  }

  private lifecyclePayload(
    migration: ClaimedSessionStorageMigration,
    input: {
      lifecycleOperationId: string;
      targetStorage: EWorkerSessionStorage;
      previousStorage: EWorkerSessionStorage;
      migrationMetadataScope: SessionStorageMigrationMetadataScope;
    }
  ): IWorkerPayload {
    if (
      !migration.server_id ||
      (input.targetStorage === EWorkerSessionStorage.postgres &&
        !migration.checkpoint_checksum)
    ) {
      throw new Error('session_storage_migration_lifecycle_scope_invalid');
    }
    return {
      action: EWorkerAction.recreate,
      worker_id: migration.worker_id,
      account_id: migration.account_id,
      server_id: migration.server_id,
      worker_type_id: migration.worker_type_id as EWorkerType,
      previous_worker_type_id: migration.worker_type_id as EWorkerType,
      worker_status_id: EWorkerStatus.recreating,
      previous_worker_status_id: EWorkerStatus.recreating,
      session_storage: input.targetStorage,
      ...(input.previousStorage === input.targetStorage
        ? {}
        : { previous_session_storage: input.previousStorage }),
      remove_session: false,
      remove_volume: false,
      lifecycle_operation_id: input.lifecycleOperationId,
      ...(input.migrationMetadataScope === 'none'
        ? {}
        : {
            session_storage_migration_id: migration.migration_id,
            ...(input.migrationMetadataScope === 'full'
              ? {
                  legacy_session_volume_name: migration.source_volume_name,
                  ...(migration.checkpoint_checksum
                    ? {
                        legacy_session_checksum: migration.checkpoint_checksum,
                      }
                    : {}),
                }
              : {}),
          }),
    };
  }

  private async prepareLifecyclePayload(
    migration: ClaimedSessionStorageMigration,
    input: {
      lifecycleOperationId: string;
      targetStorage: EWorkerSessionStorage;
      previousStorage: EWorkerSessionStorage;
      migrationMetadataScope: SessionStorageMigrationMetadataScope;
    }
  ): Promise<IWorkerPayload> {
    const payload = this.lifecyclePayload(migration, input);
    const journal: IWorkerLifecycleQueueMessage = {
      request_id: uuidv7(),
      operation_id: input.lifecycleOperationId,
      action: 'recreate',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_type_id: payload.worker_type_id,
      session_storage: payload.session_storage,
      previous_session_storage: payload.previous_session_storage,
      session_storage_migration_id: payload.session_storage_migration_id,
      legacy_session_volume_name: payload.legacy_session_volume_name,
      legacy_session_checksum: payload.legacy_session_checksum,
      worker_status_id: payload.worker_status_id,
      source: 'worker_update',
      remove_session: payload.remove_session,
      remove_volume: payload.remove_volume,
      previous_worker_type_id: payload.previous_worker_type_id,
      previous_worker_status_id: payload.previous_worker_status_id,
      requested_at: currentTime(),
    };
    // Persist the immutable command before the database lifecycle claim. A
    // fenced network command is valid only while this exact semantic identity
    // remains present in the authoritative lifecycle journal.
    await this.workerLifecycleQueueService.prepare(journal);
    return {
      ...payload,
      lifecycle_semantic_fingerprint:
        workerLifecycleSemanticFingerprint(journal),
    };
  }

  private async validateTarget(migration: ClaimedSessionStorageMigration) {
    this.assertAttemptDeadline(migration);
    if (!migration.server_id) {
      throw new Error('session_storage_migration_target_server_invalid');
    }
    const [health, fence] = await Promise.all([
      this.workerGrpcClient.runtimeHealth(
        migration.server_id,
        {
          worker_id: migration.worker_id,
        },
        15_000
      ),
      this.repository.validationFence(
        migration.worker_id,
        migration.migration_id
      ),
    ]);
    if (!fence) {
      throw new Error('session_storage_migration_validation_fence_missing');
    }
    const evidence = this.healthEvidence(
      migration,
      health,
      fence.active_revision_id
    );
    const revisionId = positiveInt(health.session_revision_id);
    const valid =
      evidence.authenticated === true &&
      evidence.session_ready === true &&
      evidence.can_send === true &&
      evidence.can_receive_runtime === true &&
      evidence.native_connection_valid === true &&
      evidence.kafka_ready === true &&
      evidence.command_ingress_ready === true &&
      evidence.command_ingress_authorized === true &&
      evidence.phone_matches === true &&
      evidence.identity_matches === true &&
      health.session_storage === EWorkerSessionStorage.postgres &&
      revisionId !== undefined &&
      revisionId === fence.active_revision_id &&
      fence.revision_status === 'active' &&
      fence.revision_source === 'legacy_volume_migration' &&
      fence.session_provider === migration.provider &&
      fence.session_state === 'ready' &&
      fence.runtime_generation === positiveInt(health.runtime_generation);
    if (!valid) {
      const expectedGeneration = positiveInt(
        migration.target_runtime_generation
      );
      const observedGeneration = positiveInt(health.runtime_generation);
      const expectedRevision = positiveInt(migration.target_revision_id);
      const observedPhone = normalizePhone(health.phone);
      const native = health.connection_status;
      const nativeTransitioning = Boolean(
        native?.provider === migration.provider &&
        native.recoverable === true &&
        TRANSIENT_TARGET_CONNECTION_STATUSES.has(native.status)
      );
      const nativeOnlineAwaitingSubsystems = Boolean(
        native?.provider === migration.provider &&
        native.status === EWhatsappConnectionStatus.online &&
        native.connected === true &&
        native.authenticated === true &&
        native.sessionValid === true &&
        native.qrAvailable === false
      );
      const revisionDoesNotContradict =
        expectedRevision === undefined ||
        (fence.active_revision_id === expectedRevision &&
          fence.revision_status === 'active' &&
          fence.revision_source === 'legacy_volume_migration' &&
          fence.session_provider === migration.provider &&
          fence.session_state === 'ready' &&
          (revisionId === undefined || revisionId === expectedRevision));
      const phoneDoesNotContradict =
        !observedPhone ||
        !migration.expected_phone ||
        observedPhone === normalizePhone(migration.expected_phone);
      const identityDoesNotContradict =
        !observedPhone ||
        !migration.expected_identity_hash ||
        createHash('sha256').update(observedPhone, 'utf8').digest('hex') ===
          migration.expected_identity_hash;
      const canRecheck = Boolean(
        migration.attempt_deadline_at &&
        Date.parse(migration.attempt_deadline_at) >
          Date.now() + TARGET_VALIDATION_RECHECK_MS &&
        expectedGeneration !== undefined &&
        observedGeneration === expectedGeneration &&
        fence.runtime_generation === expectedGeneration &&
        fence.worker_session_storage === EWorkerSessionStorage.postgres &&
        fence.runtime_session_storage === EWorkerSessionStorage.postgres &&
        health.worker_id === migration.worker_id &&
        health.session_storage === EWorkerSessionStorage.postgres &&
        (!health.session_storage_migration_id ||
          health.session_storage_migration_id === migration.migration_id) &&
        revisionDoesNotContradict &&
        phoneDoesNotContradict &&
        identityDoesNotContradict &&
        (nativeTransitioning || nativeOnlineAwaitingSubsystems)
      );
      if (canRecheck) {
        console.info('[SessionStorageMigration] target_validation_pending', {
          migration_id: migration.migration_id,
          provider: migration.provider,
          attempt: migration.attempt_count,
          runtime_generation: expectedGeneration,
          connection_status: native?.status,
          next_check_ms: TARGET_VALIDATION_RECHECK_MS,
        });
        const pending = await this.repository.transition(
          migration.migration_id,
          migration.claim_token,
          ['validating'],
          'validating',
          {
            health_evidence: evidence,
            next_attempt_at: new Date(
              Date.now() + TARGET_VALIDATION_RECHECK_MS
            ).toISOString(),
            last_error_code: null,
          }
        );
        if (pending) {
          await this.migrationService.publishSummary(
            migration.worker_id,
            toSessionStorageMigrationSummary(pending)
          );
        }
        return;
      }
      throw new Error('session_storage_migration_target_not_ready');
    }

    if (health.session_storage_migration_id === migration.migration_id) {
      await this.detachLegacyVolume(
        migration,
        fence.runtime_generation,
        revisionId
      );
      return;
    }
    if (health.session_storage_migration_id) {
      throw new Error('session_storage_migration_health_scope_mismatch');
    }

    await this.transition(migration, ['validating'], 'cleanup_pending', {
      target_runtime_generation: fence.runtime_generation,
      target_revision_id: revisionId,
      target_validated_at: new Date().toISOString(),
      health_evidence: evidence,
      next_attempt_at: null,
      last_error_code: null,
    });
  }

  private async detachLegacyVolume(
    migration: ClaimedSessionStorageMigration,
    runtimeGeneration: number,
    revisionId: number
  ) {
    const operationId = uuidv7();
    const lifecyclePayload = await this.prepareLifecyclePayload(migration, {
      lifecycleOperationId: operationId,
      targetStorage: EWorkerSessionStorage.postgres,
      previousStorage: EWorkerSessionStorage.postgres,
      // The final boot keeps only the immutable operation identity. Source
      // volume metadata must not cross this boundary or the runtime would
      // import/mount the rollback volume again instead of proving detachment.
      migrationMetadataScope: 'identity',
    });
    const begun = await this.repository.beginLifecycle({
      migrationId: migration.migration_id,
      claimToken: migration.claim_token ?? '',
      expectedStates: ['validating'],
      state: 'validating',
      targetStorage: EWorkerSessionStorage.postgres,
      targetRuntimeGeneration: runtimeGeneration + 1,
      lifecycleOperationId: operationId,
      targetRevisionId: revisionId,
    });
    if (!begun) return;
    this.observeTransition(
      begun as ClaimedSessionStorageMigration,
      'validating'
    );
    await this.workerGrpcClient.recreateWorker(
      lifecyclePayload,
      ATTEMPT_TIMEOUT_MS
    );
  }

  private healthEvidence(
    migration: ClaimedSessionStorageMigration,
    health: IWorkerRuntimeHealthResponseProto,
    revisionId: number | null
  ): WhatsappSessionStorageMigrationEvidence {
    const native = health.connection_status;
    return {
      authenticated: health.authenticated === true,
      session_ready: health.session_ready === true,
      can_send: health.can_send === true,
      can_receive_runtime: health.can_receive_runtime === true,
      native_connection_valid:
        native?.provider === migration.provider &&
        native.connected === true &&
        native.authenticated === true &&
        native.sessionValid === true,
      kafka_ready:
        health.kafka_unhealthy !== true &&
        health.kafka_consumers_ready === true &&
        health.kafka_consumers_authorized === true,
      command_ingress_ready: health.command_ingress_ready === true,
      command_ingress_authorized: health.command_ingress_authorized === true,
      runtime_generation: positiveInt(health.runtime_generation),
      revision_id: revisionId ?? undefined,
      phone_matches:
        Boolean(normalizePhone(health.phone)) &&
        (!migration.expected_phone ||
          normalizePhone(health.phone) ===
            normalizePhone(migration.expected_phone)),
      identity_matches:
        Boolean(normalizePhone(health.phone)) &&
        Boolean(migration.expected_identity_hash) &&
        createHash('sha256')
          .update(normalizePhone(health.phone), 'utf8')
          .digest('hex') === migration.expected_identity_hash,
    };
  }

  private async restore(migration: ClaimedSessionStorageMigration) {
    if (!migration.server_id) {
      throw new Error('session_storage_migration_restore_scope_missing');
    }
    const fence = await this.repository.validationFence(
      migration.worker_id,
      migration.migration_id
    );
    if (!fence) {
      throw new Error('session_storage_migration_restore_fence_missing');
    }
    if (
      fence.worker_session_storage === EWorkerSessionStorage.legacy_volume &&
      fence.runtime_session_storage === EWorkerSessionStorage.legacy_volume &&
      // A prepare attempt is process-stateful: every provider retains the
      // migration owner/result to keep retries idempotent. Reusing the source
      // process after rollback would therefore reject the next durable
      // migration id forever. Only a replacement generation is eligible for
      // the terminal health proof; otherwise recreate the preserved volume
      // once and validate that fresh process on the next pass.
      fence.runtime_generation > migration.source_runtime_generation
    ) {
      const health = await this.workerGrpcClient.runtimeHealth(
        migration.server_id,
        { worker_id: migration.worker_id },
        15_000
      );
      const native = health.connection_status;
      if (
        health.authenticated === true &&
        health.session_ready === true &&
        health.can_send === true &&
        health.can_receive_runtime === true &&
        health.session_storage === EWorkerSessionStorage.legacy_volume &&
        native?.provider === migration.provider &&
        native.connected === true &&
        native.authenticated === true &&
        native.sessionValid === true &&
        (!migration.expected_phone ||
          normalizePhone(health.phone) ===
            normalizePhone(migration.expected_phone))
      ) {
        const restored = await this.repository.finalizeRestoration(
          migration.migration_id,
          migration.worker_id,
          migration.claim_token ?? ''
        );
        if (!restored) {
          throw new Error('session_storage_migration_restoration_claim_lost');
        }
        this.observeTransition(
          restored as ClaimedSessionStorageMigration,
          'restored'
        );
        await this.migrationService.publishSummary(
          migration.worker_id,
          toSessionStorageMigrationSummary(restored)
        );
        sessionStorageMigrationTelemetryStore.recordRestoration(
          migration.provider
        );
        return;
      }
    }

    const operationId = uuidv7();
    const lifecyclePayload = await this.prepareLifecyclePayload(migration, {
      lifecycleOperationId: operationId,
      targetStorage: EWorkerSessionStorage.legacy_volume,
      previousStorage: fence.runtime_session_storage,
      migrationMetadataScope:
        fence.runtime_session_storage === EWorkerSessionStorage.postgres
          ? 'full'
          : 'none',
    });
    const begun = await this.repository.beginLifecycle({
      migrationId: migration.migration_id,
      claimToken: migration.claim_token ?? '',
      expectedStates: ['restoring'],
      state: 'restoring',
      targetStorage: EWorkerSessionStorage.legacy_volume,
      targetRuntimeGeneration: fence.runtime_generation + 1,
      lifecycleOperationId: operationId,
    });
    if (!begun) return;
    await this.workerGrpcClient.recreateWorker(
      lifecyclePayload,
      ATTEMPT_TIMEOUT_MS
    );
  }

  private assertAttemptDeadline(migration: ClaimedSessionStorageMigration) {
    if (
      !migration.attempt_deadline_at ||
      Date.parse(migration.attempt_deadline_at) <= Date.now()
    ) {
      throw new Error('session_storage_migration_attempt_timeout');
    }
  }

  private async handleFailure(
    migration: ClaimedSessionStorageMigration,
    error: unknown
  ) {
    const latest = await this.repository.latest(migration.worker_id);
    if (
      !latest ||
      ['restored', 'completed', 'cleanup_pending'].includes(latest.state)
    ) {
      return;
    }
    const errorCode = sanitizeError(error);
    sessionStorageMigrationTelemetryStore.recordFailure(
      latest.provider,
      latest.state
    );
    if (latest.attempt_started_at) {
      sessionStorageMigrationTelemetryStore.recordAttemptDuration(
        latest.provider,
        Date.now() - Date.parse(latest.attempt_started_at)
      );
    }
    console.warn('[SessionStorageMigration] attempt_failed', {
      migration_id: latest.migration_id,
      provider: latest.provider,
      phase: latest.state,
      attempt: latest.attempt_count,
      duration_ms: latest.attempt_started_at
        ? Math.max(0, Date.now() - Date.parse(latest.attempt_started_at))
        : undefined,
      error_code: errorCode,
    });
    if (latest.state === 'restoring') {
      if (errorCode.includes(SOURCE_VOLUME_MISSING_ERROR)) {
        const updated = await this.repository.transition(
          latest.migration_id,
          null,
          ['restoring'],
          'recovery_required',
          {
            next_attempt_at: null,
            source_volume_preserved: false,
            last_error_code: SOURCE_VOLUME_MISSING_ERROR,
          }
        );
        if (updated) {
          this.observeTransition(
            updated as ClaimedSessionStorageMigration,
            'recovery_required'
          );
          await this.migrationService.publishSummary(
            latest.worker_id,
            toSessionStorageMigrationSummary(updated)
          );
        }
        return;
      }
      const updated = await this.repository.transition(
        latest.migration_id,
        null,
        ['restoring'],
        'restoring',
        {
          next_attempt_at: new Date(Date.now() + 15_000).toISOString(),
          last_error_code: errorCode,
        }
      );
      if (updated) {
        this.observeTransition(
          updated as ClaimedSessionStorageMigration,
          'restoring'
        );
        await this.migrationService.publishSummary(
          latest.worker_id,
          toSessionStorageMigrationSummary(updated)
        );
      }
      return;
    }
    const exhausted = latest.attempt_count >= 3;
    const nextState = exhausted ? 'restoring' : 'retry_wait';
    const backoff = exhausted
      ? 0
      : (RETRY_BACKOFF_MS[Math.max(0, latest.attempt_count - 1)] ?? 15_000);
    const updated = await this.repository.transition(
      latest.migration_id,
      null,
      [latest.state],
      nextState,
      {
        next_attempt_at: new Date(Date.now() + backoff).toISOString(),
        last_error_code: errorCode,
      }
    );
    if (updated) {
      this.observeTransition(
        updated as ClaimedSessionStorageMigration,
        nextState
      );
      await this.migrationService.publishSummary(
        latest.worker_id,
        toSessionStorageMigrationSummary(updated)
      );
    }
  }
}
