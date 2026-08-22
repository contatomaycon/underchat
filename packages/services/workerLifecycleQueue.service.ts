import { inject, injectable } from 'tsyringe';
import type { MessageHeader } from 'node-rdkafka';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KAFKA_GLOBAL_TOPIC_CONFIG } from '@core/common/functions/kafkaTopicConfig';
import { KafkaService } from '@core/services/kafka.service';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { ConnectionLifecycleDebugService } from '@core/services/connectionLifecycleDebug.service';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { currentTime } from '@core/common/functions/currentTime';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  WorkerDeletionProofService,
  workerLifecycleJournalKey,
} from '@core/services/workerDeletionProof.service';
import {
  legacyWorkerLifecyclePhaseLineageFingerprintV1,
  legacyWorkerLifecycleSemanticFingerprintV1,
  workerLifecyclePhaseLineageFingerprint,
  workerLifecycleSemanticFingerprint,
} from '@core/common/functions/workerLifecycleSemanticFingerprint';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { supportsWhatsappSessionStorage } from '@core/common/functions/workerSessionStorage';
import {
  hasWorkerLifecycleSessionStorageMigrationMetadata,
  isProtectedWorkerLifecycleSessionStorageMigration,
  isProtectedWorkerLifecycleSessionStorageMigrationFinalization,
} from '@core/common/functions/workerLifecycleSessionStorageMigration';

const configuredLifecycleJournalTtlSeconds = Number(
  process.env.WORKER_LIFECYCLE_JOURNAL_TTL_SECONDS
);
const LIFECYCLE_JOURNAL_TTL_SECONDS = Math.max(
  60 * 60,
  Number.isFinite(configuredLifecycleJournalTtlSeconds) &&
    configuredLifecycleJournalTtlSeconds > 0
    ? Math.floor(configuredLifecycleJournalTtlSeconds)
    : 30 * 24 * 60 * 60
);
const DELETE_PROOF_FIELDS = new Set([
  'permanent_delete_proof_v1',
  'permanent_delete_finalized_v1',
]);
const WORKER_TYPES = new Set<string>(Object.values(EWorkerType));
const WORKER_STATUSES = new Set<string>(Object.values(EWorkerStatus));
const WORKER_SESSION_STORAGES = new Set<string>(
  Object.values(EWorkerSessionStorage)
);
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/i;
const CONTAINER_HEALTH_STATUSES = new Set([
  'unhealthy',
  'healthy',
  'starting',
  'none',
]);
const ACTION_SOURCES: Record<
  Exclude<IWorkerLifecycleQueueMessage['action'], 'delete'>,
  ReadonlySet<IWorkerLifecycleQueueMessage['source']>
> = {
  create: new Set(['worker_create']),
  recreate: new Set([
    'worker_recreate',
    'worker_update',
    'config_recreate',
    'reset_connection',
    'self_heal',
  ]),
  activate_warm: new Set(['worker_create', 'worker_update']),
  cleanup_previous_runtime: new Set([
    'worker_update',
    'reset_connection',
    'plan_limit_enforcement',
  ]),
};
const JOURNAL_SEMANTIC_META_PREFIX =
  '__worker_lifecycle_semantic_fingerprint_v1:';
const JOURNAL_LINEAGE_META_PREFIX =
  '__worker_lifecycle_phase_lineage_fingerprint_v1:';
const WRITE_LIFECYCLE_JOURNAL_FIELD_SCRIPT = `
  local function same_scalar(left, right, field)
    local left_value = left[field]
    local right_value = right[field]
    return type(left_value) == type(right_value) and left_value == right_value
  end

  local semantic_fields = {
    'operation_id',
    'action',
    'worker_id',
    'account_id',
    'server_id',
    'worker_type_id',
    'session_storage',
    'previous_session_storage',
    'session_storage_migration_id',
    'legacy_session_volume_name',
    'legacy_session_checksum',
    'worker_status_id',
    'source',
    'remove_session',
    'remove_volume',
    'warm_pool_id',
    'previous_server_id',
    'previous_worker_type_id',
    'previous_worker_status_id',
    'recreate_server_slot_key',
    'recreate_server_slot_token',
    'recovery_without_journal',
    'cleanup_previous_runtime_required',
    'expected_container_id',
    'expected_container_started_at',
    'expected_container_restart_count',
    'expected_container_health_status',
    'expected_container_paused',
    'expected_runtime_generation'
  }
  local lineage_fields = {
    'operation_id',
    'worker_id',
    'account_id',
    'server_id',
    'worker_type_id',
    'session_storage',
    'previous_session_storage',
    'session_storage_migration_id',
    'legacy_session_volume_name',
    'legacy_session_checksum',
    'worker_status_id',
    'source',
    'remove_session',
    'remove_volume',
    'previous_server_id',
    'previous_worker_type_id',
    'previous_worker_status_id',
    'recreate_server_slot_key',
    'recreate_server_slot_token',
    'recovery_without_journal',
    'cleanup_previous_runtime_required',
    'expected_container_id',
    'expected_container_started_at',
    'expected_container_restart_count',
    'expected_container_health_status',
    'expected_container_paused',
    'expected_runtime_generation'
  }

  local function same_fields(left, right, fields)
    for _, field in ipairs(fields) do
      if not same_scalar(left, right, field) then
        return false
      end
    end
    return true
  end

  local incoming_ok, incoming = pcall(cjson.decode, ARGV[2])
  if not incoming_ok or type(incoming) ~= 'table' then
    return redis.error_reply('worker lifecycle journal incoming payload is malformed')
  end

  if string.sub(ARGV[1], 1, 8) == 'cleanup:' then
    local fields = redis.call('HKEYS', KEYS[1])
    for _, field in ipairs(fields) do
      if string.sub(field, 1, 8) == 'cleanup:' and field ~= ARGV[1] then
        return redis.error_reply('worker lifecycle journal cleanup semantic conflict')
      end
    end
  end

  local current = redis.call('HGET', KEYS[1], ARGV[1])
  if current then
    local ok, decoded = pcall(cjson.decode, current)
    if not ok or type(decoded) ~= 'table' then
      return redis.error_reply('worker lifecycle journal current payload is malformed')
    end
    if decoded.worker_id ~= ARGV[4] or decoded.operation_id ~= ARGV[5] then
      return redis.error_reply('worker lifecycle journal current identity is invalid')
    end
    local stored_semantic = redis.call('HGET', KEYS[1], ARGV[8])
    local stored_lineage = redis.call('HGET', KEYS[1], ARGV[9])
    if (stored_semantic and not stored_lineage)
      or (stored_lineage and not stored_semantic) then
      return redis.error_reply('worker lifecycle journal fingerprint metadata is incomplete')
    end
    local same_semantic = same_fields(decoded, incoming, semantic_fields)
    local same_lineage = same_fields(decoded, incoming, lineage_fields)

    if stored_semantic and same_semantic
      and (stored_semantic ~= ARGV[6] or stored_lineage ~= ARGV[7]) then
      return redis.error_reply('worker lifecycle journal fingerprint integrity mismatch')
    end
    if stored_lineage and same_lineage and stored_lineage ~= ARGV[7] then
      return redis.error_reply('worker lifecycle journal lineage integrity mismatch')
    end

    if ARGV[1] == 'primary' then
      if decoded.action ~= 'create'
        and decoded.action ~= 'recreate'
        and decoded.action ~= 'activate_warm' then
        return redis.error_reply('worker lifecycle journal primary action is invalid')
      end
      if not same_semantic then
        if decoded.action == 'activate_warm' and ARGV[3] ~= 'activate_warm' then
          if same_lineage then
            return 0
          end
          return redis.error_reply('worker lifecycle journal primary semantic conflict')
        end
        if decoded.action ~= 'activate_warm' and ARGV[3] == 'activate_warm' then
          if not same_lineage then
            return redis.error_reply('worker lifecycle journal phase lineage conflict')
          end
          local expected_predecessor_semantic = decoded.action == 'create'
            and ARGV[10] or ARGV[11]
          if stored_semantic
            and stored_semantic ~= expected_predecessor_semantic then
            return redis.error_reply('worker lifecycle journal predecessor fingerprint integrity mismatch')
          end
          if redis.call('EXISTS', KEYS[2]) == 1 then
            return 2
          end
        else
          return redis.error_reply('worker lifecycle journal primary semantic conflict')
        end
      end
    else
      if decoded.action ~= 'cleanup_previous_runtime' then
        return redis.error_reply('worker lifecycle journal cleanup action is invalid')
      end
      if not same_semantic then
        return redis.error_reply('worker lifecycle journal cleanup semantic conflict')
      end
    end

    if same_semantic and stored_semantic and stored_lineage
      and decoded.redrive_claim_token == nil then
      -- A retry of the same durable operation must not move requested_at
      -- forward. The liveness redrive uses that immutable age to decide when
      -- a command is stranded; replacing the envelope on every caller retry
      -- can otherwise starve redrive forever at the eligibility boundary.
      return 0
    end
  end
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
  redis.call('HSET', KEYS[1], ARGV[8], ARGV[6])
  redis.call('HSET', KEYS[1], ARGV[9], ARGV[7])
  return 1
`;
const REPAIR_LIFECYCLE_FINGERPRINT_METADATA_SCRIPT = `
  local current_payload = redis.call('HGET', KEYS[1], ARGV[1])
  local current_semantic = redis.call('HGET', KEYS[1], ARGV[2])
  local current_lineage = redis.call('HGET', KEYS[1], ARGV[3])

  if current_payload ~= ARGV[4]
    or current_semantic ~= ARGV[5]
    or current_lineage ~= ARGV[6] then
    return 0
  end
  if redis.call('EXISTS', KEYS[2]) == 1 then
    return 2
  end

  redis.call('HSET', KEYS[1], ARGV[2], ARGV[7])
  redis.call('HSET', KEYS[1], ARGV[3], ARGV[8])
  return 1
`;

type FingerprintMetadataRepairResult =
  'not_applicable' | 'repaired' | 'raced' | 'locked';

export class WorkerLifecycleJournalError extends Error {
  constructor(
    readonly reason: string,
    options?: ErrorOptions
  ) {
    super(`worker_lifecycle_journal_invalid:${reason}`, options);
    this.name = 'WorkerLifecycleJournalError';
    Object.setPrototypeOf(this, WorkerLifecycleJournalError.prototype);
  }
}

export interface PreparePermanentWorkerDeletionInput {
  worker_id: string;
  account_id: string;
  server_id: string;
  worker_type_id?: IWorkerLifecycleQueueMessage['worker_type_id'];
  session_storage?: IWorkerLifecycleQueueMessage['session_storage'];
  source: IWorkerLifecycleQueueMessage['source'];
  lifecycle_operation_id?: string;
  debug_trace_id?: string;
}

@injectable()
export class WorkerLifecycleQueueService {
  private readonly workerDeletionProofService: WorkerDeletionProofService;

  constructor(
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaService)
    private readonly kafkaService: KafkaService,
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService,
    @inject('Redis')
    private readonly redis: Redis | undefined = undefined
  ) {
    this.workerDeletionProofService = new WorkerDeletionProofService(redis);
  }

  private journalKey(workerId: string, operationId: string): string {
    return workerLifecycleJournalKey(workerId, operationId);
  }

  private journalField(payload: IWorkerLifecycleQueueMessage): string {
    return payload.action === 'cleanup_previous_runtime'
      ? `cleanup:${payload.server_id}:${payload.worker_type_id ?? ''}`
      : 'primary';
  }

  private journalSemanticMetaField(field: string): string {
    return `${JOURNAL_SEMANTIC_META_PREFIX}${field}`;
  }

  private journalLineageMetaField(field: string): string {
    return `${JOURNAL_LINEAGE_META_PREFIX}${field}`;
  }

  private durablePayload(
    payload: IWorkerLifecycleQueueMessage
  ): IWorkerLifecycleQueueMessage {
    const durablePayload = { ...payload };
    delete durablePayload.redrive_claim_token;
    return durablePayload;
  }

  private isDestructivePostgresProviderReset(
    payload: IWorkerLifecycleQueueMessage,
    changesWorkerType: boolean
  ): boolean {
    return (
      payload.source === 'worker_update' &&
      payload.action === 'recreate' &&
      changesWorkerType &&
      payload.session_storage === EWorkerSessionStorage.postgres &&
      payload.previous_session_storage === undefined &&
      payload.remove_session === true &&
      payload.remove_volume === false &&
      payload.cleanup_previous_runtime_required === true
    );
  }

  private isDestructivePostgresProviderResetCleanupPair(
    primary: IWorkerLifecycleQueueMessage | undefined,
    cleanup: IWorkerLifecycleQueueMessage | undefined
  ): boolean {
    return Boolean(
      primary &&
      cleanup &&
      this.isDestructivePostgresProviderReset(
        primary,
        primary.previous_worker_type_id !== undefined &&
          primary.previous_worker_type_id !== primary.worker_type_id
      ) &&
      cleanup.action === 'cleanup_previous_runtime' &&
      cleanup.source === 'worker_update' &&
      cleanup.session_storage === EWorkerSessionStorage.postgres &&
      cleanup.previous_session_storage === undefined &&
      cleanup.remove_session === false &&
      cleanup.remove_volume === false &&
      cleanup.cleanup_previous_runtime_required === undefined
    );
  }

  private assertJournalPayloadShape(
    payload: IWorkerLifecycleQueueMessage,
    workerId: string,
    operationId: string
  ): void {
    const nonEmpty = (value: unknown): value is string =>
      typeof value === 'string' && value.trim().length > 0;
    if (
      payload.worker_id !== workerId ||
      payload.operation_id !== operationId ||
      !nonEmpty(payload.request_id) ||
      !nonEmpty(payload.account_id) ||
      !nonEmpty(payload.server_id) ||
      !nonEmpty(payload.source) ||
      !nonEmpty(payload.requested_at) ||
      (payload.previous_server_id !== undefined &&
        !nonEmpty(payload.previous_server_id)) ||
      !Number.isFinite(Date.parse(payload.requested_at)) ||
      payload.action === 'delete' ||
      !WORKER_TYPES.has(payload.worker_type_id ?? '') ||
      !WORKER_STATUSES.has(payload.worker_status_id ?? '') ||
      !ACTION_SOURCES[payload.action].has(payload.source)
    ) {
      throw new WorkerLifecycleJournalError('payload_identity_mismatch');
    }

    const statusMatches =
      (payload.action === 'create' &&
        payload.worker_status_id === EWorkerStatus.creating) ||
      (payload.action === 'recreate' &&
        payload.worker_status_id === EWorkerStatus.recreating) ||
      (payload.action === 'activate_warm' &&
        (payload.worker_status_id === EWorkerStatus.creating ||
          payload.worker_status_id === EWorkerStatus.recreating)) ||
      (payload.action === 'cleanup_previous_runtime' &&
        (payload.worker_status_id === EWorkerStatus.recreating ||
          payload.worker_status_id === EWorkerStatus.blocked));
    const changesWorkerType =
      payload.previous_worker_type_id !== undefined &&
      payload.previous_worker_type_id !== payload.worker_type_id;
    const legacyToPostgresConversion =
      (payload.source === 'worker_update' ||
        payload.source === 'reset_connection') &&
      (payload.action === 'recreate' ||
        payload.action === 'cleanup_previous_runtime') &&
      payload.previous_session_storage ===
        EWorkerSessionStorage.legacy_volume &&
      payload.session_storage === EWorkerSessionStorage.postgres &&
      payload.remove_session === true &&
      payload.remove_volume === true;
    /*
     * An explicit "fresh" provider edit keeps PostgreSQL as the storage
     * backend, but intentionally deletes the previous authenticated session.
     * This is different from a protected provider handoff (which preserves
     * the session) and from a legacy-volume conversion (which also removes a
     * Docker volume). The producer expresses that distinction through the
     * destructive flags and a mandatory cleanup proof on the primary; keep
     * the accepted shape narrow so a malformed migration cannot silently
     * become destructive. The paired cleanup keeps the source provider as
     * both its current and previous type, so it passes the ordinary
     * same-provider validation path.
     */
    const destructivePostgresProviderReset =
      this.isDestructivePostgresProviderReset(payload, changesWorkerType);
    const protectedSessionStorageMigration =
      isProtectedWorkerLifecycleSessionStorageMigration(payload);
    const protectedSessionStorageMigrationFinalization =
      isProtectedWorkerLifecycleSessionStorageMigrationFinalization(payload);
    const protectedSessionStorageMigrationCommand =
      protectedSessionStorageMigration ||
      protectedSessionStorageMigrationFinalization;
    const hasSessionStorageMigrationMetadata =
      hasWorkerLifecycleSessionStorageMigrationMetadata(payload);
    const changesUnsupportedWorkerType =
      changesWorkerType &&
      (!supportsWhatsappSessionStorage(payload.previous_worker_type_id) ||
        !supportsWhatsappSessionStorage(payload.worker_type_id));
    if (
      !statusMatches ||
      (payload.action === 'activate_warm' && !nonEmpty(payload.warm_pool_id)) ||
      (payload.session_storage !== undefined &&
        !WORKER_SESSION_STORAGES.has(payload.session_storage)) ||
      (payload.previous_session_storage !== undefined &&
        !WORKER_SESSION_STORAGES.has(payload.previous_session_storage)) ||
      (payload.previous_session_storage !== undefined &&
        !legacyToPostgresConversion &&
        !protectedSessionStorageMigrationCommand) ||
      (hasSessionStorageMigrationMetadata &&
        !protectedSessionStorageMigrationCommand) ||
      (payload.session_storage === EWorkerSessionStorage.postgres &&
        payload.remove_volume === true &&
        !legacyToPostgresConversion) ||
      (payload.previous_worker_type_id !== undefined &&
        !WORKER_TYPES.has(payload.previous_worker_type_id)) ||
      changesUnsupportedWorkerType ||
      (changesWorkerType &&
        !legacyToPostgresConversion &&
        !destructivePostgresProviderReset &&
        (payload.session_storage !== EWorkerSessionStorage.postgres ||
          payload.remove_session !== false ||
          payload.remove_volume !== false)) ||
      (legacyToPostgresConversion &&
        payload.action === 'recreate' &&
        payload.cleanup_previous_runtime_required !== true) ||
      (payload.previous_worker_status_id !== undefined &&
        !WORKER_STATUSES.has(payload.previous_worker_status_id))
    ) {
      throw new WorkerLifecycleJournalError('payload_semantics_invalid');
    }

    for (const value of [
      payload.remove_session,
      payload.remove_volume,
      payload.recovery_without_journal,
      payload.cleanup_previous_runtime_required,
    ]) {
      if (value !== undefined && typeof value !== 'boolean') {
        throw new WorkerLifecycleJournalError('payload_semantics_invalid');
      }
    }
    const hasSlotKey = nonEmpty(payload.recreate_server_slot_key);
    const hasSlotToken = nonEmpty(payload.recreate_server_slot_token);
    if (hasSlotKey !== hasSlotToken) {
      throw new WorkerLifecycleJournalError('payload_semantics_invalid');
    }

    const livenessValues = [
      payload.expected_container_id,
      payload.expected_container_started_at,
      payload.expected_container_restart_count,
      payload.expected_container_health_status,
      payload.expected_container_paused,
      payload.expected_runtime_generation,
    ];
    const presentLivenessValues = livenessValues.filter(
      (value) => value !== undefined
    );
    if (
      presentLivenessValues.length !== 0 &&
      presentLivenessValues.length !== livenessValues.length
    ) {
      throw new WorkerLifecycleJournalError('liveness_fence_incomplete');
    }
    if (presentLivenessValues.length === livenessValues.length) {
      const healthStatus = payload.expected_container_health_status;
      const restartCount = payload.expected_container_restart_count;
      if (
        payload.action !== 'recreate' ||
        payload.source !== 'worker_recreate' ||
        !nonEmpty(payload.expected_container_id) ||
        !CONTAINER_ID_PATTERN.test(payload.expected_container_id) ||
        !nonEmpty(payload.expected_container_started_at) ||
        !Number.isFinite(Date.parse(payload.expected_container_started_at)) ||
        typeof restartCount !== 'number' ||
        !Number.isSafeInteger(restartCount) ||
        restartCount < 0 ||
        !nonEmpty(healthStatus) ||
        !CONTAINER_HEALTH_STATUSES.has(healthStatus) ||
        typeof payload.expected_container_paused !== 'boolean' ||
        (!payload.expected_container_paused &&
          healthStatus !== 'unhealthy' &&
          !(healthStatus === 'starting' && restartCount >= 1)) ||
        typeof payload.expected_runtime_generation !== 'number' ||
        !Number.isSafeInteger(payload.expected_runtime_generation) ||
        payload.expected_runtime_generation <= 0
      ) {
        throw new WorkerLifecycleJournalError('liveness_fence_invalid');
      }
    }
  }

  private async compareAndSwapFingerprintMetadata(input: {
    journalKey: string;
    field: string;
    serializedPayload: string;
    workerId: string;
    expectedSemanticFingerprint: string;
    expectedLineageFingerprint: string;
    repairedSemanticFingerprint: string;
    repairedLineageFingerprint: string;
  }): Promise<FingerprintMetadataRepairResult> {
    const redis = this.redis;
    if (!redis) {
      throw new WorkerLifecycleJournalError('redis_unavailable');
    }

    let result: number;
    try {
      result = Number(
        await redis.eval(
          REPAIR_LIFECYCLE_FINGERPRINT_METADATA_SCRIPT,
          2,
          input.journalKey,
          `underchat:worker:lifecycle:lock:${input.workerId}`,
          input.field,
          this.journalSemanticMetaField(input.field),
          this.journalLineageMetaField(input.field),
          input.serializedPayload,
          input.expectedSemanticFingerprint,
          input.expectedLineageFingerprint,
          input.repairedSemanticFingerprint,
          input.repairedLineageFingerprint
        )
      );
    } catch (error) {
      throw new WorkerLifecycleJournalError(
        'fingerprint_repair_command_failed',
        { cause: error }
      );
    }

    if (result === 1) {
      return 'repaired';
    }
    if (result === 0) {
      return 'raced';
    }
    if (result === 2) {
      return 'locked';
    }
    throw new WorkerLifecycleJournalError('fingerprint_repair_result_invalid');
  }

  private async repairLegacySessionStorageMetadata(input: {
    journalKey: string;
    field: string;
    serializedPayload: string;
    payload: IWorkerLifecycleQueueMessage;
    storedSemanticFingerprint: string | undefined;
    storedLineageFingerprint: string | undefined;
  }): Promise<FingerprintMetadataRepairResult> {
    const {
      journalKey,
      field,
      serializedPayload,
      payload,
      storedSemanticFingerprint,
      storedLineageFingerprint,
    } = input;

    /*
     * The release that introduced session_storage changed the fingerprint
     * inputs without changing the v1 Redis metadata names. Only journals that
     * predate that field are eligible for repair. Requiring the field to be
     * absent prevents an attacker from adding/changing a storage backend that
     * the legacy hashes deliberately did not cover.
     */
    if (
      payload.session_storage !== undefined ||
      !storedSemanticFingerprint ||
      !storedLineageFingerprint
    ) {
      return 'not_applicable';
    }

    const legacySemanticFingerprint =
      legacyWorkerLifecycleSemanticFingerprintV1(payload);
    const legacyLineageFingerprint =
      legacyWorkerLifecyclePhaseLineageFingerprintV1(payload);
    if (
      storedSemanticFingerprint !== legacySemanticFingerprint ||
      storedLineageFingerprint !== legacyLineageFingerprint
    ) {
      return 'not_applicable';
    }

    return this.compareAndSwapFingerprintMetadata({
      journalKey,
      field,
      serializedPayload,
      workerId: payload.worker_id,
      expectedSemanticFingerprint: legacySemanticFingerprint,
      expectedLineageFingerprint: legacyLineageFingerprint,
      repairedSemanticFingerprint: workerLifecycleSemanticFingerprint(payload),
      repairedLineageFingerprint:
        workerLifecyclePhaseLineageFingerprint(payload),
    });
  }

  private async repairMixedVersionWarmMetadata(input: {
    journalKey: string;
    field: string;
    serializedPayload: string;
    payload: IWorkerLifecycleQueueMessage;
    storedSemanticFingerprint: string | undefined;
    storedLineageFingerprint: string | undefined;
  }): Promise<FingerprintMetadataRepairResult> {
    const {
      journalKey,
      field,
      serializedPayload,
      payload,
      storedSemanticFingerprint,
      storedLineageFingerprint,
    } = input;
    if (
      field !== 'primary' ||
      payload.action !== 'activate_warm' ||
      !storedSemanticFingerprint ||
      !storedLineageFingerprint
    ) {
      return 'not_applicable';
    }

    const predecessorAction =
      payload.source === 'worker_create'
        ? 'create'
        : payload.source === 'worker_update'
          ? 'recreate'
          : undefined;
    if (!predecessorAction) {
      return 'not_applicable';
    }

    const predecessorPayload: IWorkerLifecycleQueueMessage = {
      ...payload,
      action: predecessorAction,
      warm_pool_id: undefined,
    };
    const lineageFingerprint = workerLifecyclePhaseLineageFingerprint(payload);
    const predecessorSemanticFingerprint =
      workerLifecycleSemanticFingerprint(predecessorPayload);
    const currentPredecessorMatches =
      storedLineageFingerprint === lineageFingerprint &&
      storedSemanticFingerprint === predecessorSemanticFingerprint;

    const legacyLineageFingerprint =
      legacyWorkerLifecyclePhaseLineageFingerprintV1(payload);
    const legacyPredecessorSemanticFingerprint =
      legacyWorkerLifecycleSemanticFingerprintV1(predecessorPayload);
    const legacyPredecessorMatches =
      payload.session_storage === undefined &&
      storedLineageFingerprint === legacyLineageFingerprint &&
      storedSemanticFingerprint === legacyPredecessorSemanticFingerprint;
    if (!currentPredecessorMatches && !legacyPredecessorMatches) {
      return 'not_applicable';
    }

    return this.compareAndSwapFingerprintMetadata({
      journalKey,
      field,
      serializedPayload,
      workerId: payload.worker_id,
      expectedSemanticFingerprint: currentPredecessorMatches
        ? predecessorSemanticFingerprint
        : legacyPredecessorSemanticFingerprint,
      expectedLineageFingerprint: currentPredecessorMatches
        ? lineageFingerprint
        : legacyLineageFingerprint,
      repairedSemanticFingerprint: workerLifecycleSemanticFingerprint(payload),
      repairedLineageFingerprint: lineageFingerprint,
    });
  }

  async preparePermanentDeletion(
    input: PreparePermanentWorkerDeletionInput
  ): Promise<IWorkerLifecycleQueueMessage> {
    const operationId = input.lifecycle_operation_id?.trim() || uuidv7();
    if (input.lifecycle_operation_id) {
      const existing = await this.workerDeletionProofService.load(
        input.worker_id,
        operationId
      );
      if (!existing) {
        throw new Error(
          'Existing worker deletion operation is missing its immutable proof'
        );
      }
      if (
        existing.account_id !== input.account_id ||
        existing.action !== 'delete'
      ) {
        throw new Error(
          'Permanent worker deletion proof identity does not match'
        );
      }
      await this.workerDeletionProofService.prepare(
        existing,
        LIFECYCLE_JOURNAL_TTL_SECONDS
      );
      return existing;
    }
    const payload: IWorkerLifecycleQueueMessage = {
      request_id: uuidv7(),
      operation_id: operationId,
      action: 'delete',
      worker_id: input.worker_id,
      account_id: input.account_id,
      server_id: input.server_id,
      worker_type_id: input.worker_type_id,
      session_storage: input.session_storage,
      worker_status_id: EWorkerStatus.deleting,
      source: input.source,
      debug_trace_id: input.debug_trace_id?.trim() || operationId,
      requested_at: currentTime(),
    };
    await this.prepare(payload);
    return payload;
  }

  /**
   * Persist the exact command before the database lifecycle claim is made.
   * A later, more specific primary command (for example activate_warm) replaces
   * the recovery command while cleanup commands remain separate hash fields.
   */
  async prepare(payload: IWorkerLifecycleQueueMessage): Promise<void> {
    const durablePayload = this.durablePayload(payload);
    if (durablePayload.action === 'delete') {
      await this.workerDeletionProofService.prepare(
        durablePayload,
        LIFECYCLE_JOURNAL_TTL_SECONDS
      );
      return;
    }

    this.assertJournalPayloadShape(
      durablePayload,
      durablePayload.worker_id,
      durablePayload.operation_id
    );
    if (!this.redis) {
      throw new WorkerLifecycleJournalError('redis_unavailable');
    }

    const field = this.journalField(durablePayload);
    const result = await this.redis
      .multi()
      .eval(
        WRITE_LIFECYCLE_JOURNAL_FIELD_SCRIPT,
        2,
        this.journalKey(durablePayload.worker_id, durablePayload.operation_id),
        `underchat:worker:lifecycle:lock:${durablePayload.worker_id}`,
        field,
        JSON.stringify(durablePayload),
        durablePayload.action,
        durablePayload.worker_id,
        durablePayload.operation_id,
        workerLifecycleSemanticFingerprint(durablePayload),
        workerLifecyclePhaseLineageFingerprint(durablePayload),
        this.journalSemanticMetaField(field),
        this.journalLineageMetaField(field),
        workerLifecycleSemanticFingerprint({
          ...durablePayload,
          action: 'create',
          warm_pool_id: undefined,
        }),
        workerLifecycleSemanticFingerprint({
          ...durablePayload,
          action: 'recreate',
          warm_pool_id: undefined,
        })
      )
      .expire(
        this.journalKey(durablePayload.worker_id, durablePayload.operation_id),
        LIFECYCLE_JOURNAL_TTL_SECONDS
      )
      .exec();

    if (!result) {
      throw new WorkerLifecycleJournalError('transaction_aborted');
    }
    if (result.length !== 2) {
      throw new WorkerLifecycleJournalError('transaction_result_incomplete');
    }

    for (const entry of result) {
      if (!Array.isArray(entry) || entry.length < 1) {
        throw new WorkerLifecycleJournalError('transaction_result_malformed');
      }
      const [error] = entry;
      if (error) {
        throw new WorkerLifecycleJournalError('transaction_command_failed', {
          cause: error,
        });
      }
      if (entry.length < 2) {
        throw new WorkerLifecycleJournalError('transaction_result_malformed');
      }
    }

    const journalWriteResult = Number(result[0]?.[1]);
    const expireResult = Number(result[1]?.[1]);
    if (journalWriteResult === 2) {
      throw new WorkerLifecycleJournalError('phase_upgrade_locked');
    }
    if (
      (journalWriteResult !== 0 && journalWriteResult !== 1) ||
      expireResult !== 1
    ) {
      throw new WorkerLifecycleJournalError('transaction_not_confirmed');
    }
  }

  async loadAuthoritativePreparedPayload(
    requested: IWorkerLifecycleQueueMessage
  ): Promise<IWorkerLifecycleQueueMessage | null> {
    if (requested.action === 'delete') {
      const deletionProof = await this.workerDeletionProofService.load(
        requested.worker_id,
        requested.operation_id
      );
      return deletionProof ? this.durablePayload(deletionProof) : null;
    }

    const prepared = await this.loadPrepared(
      requested.worker_id,
      requested.operation_id
    );
    const authoritative =
      requested.action === 'cleanup_previous_runtime'
        ? prepared.find(
            (candidate) =>
              candidate.action === 'cleanup_previous_runtime' &&
              candidate.server_id === requested.server_id &&
              candidate.worker_type_id === requested.worker_type_id
          )
        : prepared.find(
            (candidate) => candidate.action !== 'cleanup_previous_runtime'
          );
    return authoritative ?? null;
  }

  async loadPrepared(
    workerId: string,
    operationId: string
  ): Promise<IWorkerLifecycleQueueMessage[]> {
    return this.loadPreparedWithMixedVersionRepair(
      workerId,
      operationId,
      false
    );
  }

  private async loadPreparedWithMixedVersionRepair(
    workerId: string,
    operationId: string,
    repairRaceRetried: boolean
  ): Promise<IWorkerLifecycleQueueMessage[]> {
    if (!this.redis) {
      throw new WorkerLifecycleJournalError('redis_unavailable');
    }

    const journalKey = this.journalKey(workerId, operationId);
    const deletionProof = await this.workerDeletionProofService.load(
      workerId,
      operationId
    );
    const fields = await this.redis.hgetall(journalKey);
    const payloads: IWorkerLifecycleQueueMessage[] = [];
    let primary: IWorkerLifecycleQueueMessage | undefined;
    const cleanup: IWorkerLifecycleQueueMessage[] = [];
    const semanticFingerprints = new Map<string, string>();
    const lineageFingerprints = new Map<string, string>();
    const payloadFields = new Set<string>();

    for (const [field, value] of Object.entries(fields)) {
      if (field.startsWith(JOURNAL_SEMANTIC_META_PREFIX)) {
        semanticFingerprints.set(
          field.slice(JOURNAL_SEMANTIC_META_PREFIX.length),
          value
        );
      } else if (field.startsWith(JOURNAL_LINEAGE_META_PREFIX)) {
        lineageFingerprints.set(
          field.slice(JOURNAL_LINEAGE_META_PREFIX.length),
          value
        );
      }
    }

    for (const [field, value] of Object.entries(fields)) {
      if (DELETE_PROOF_FIELDS.has(field)) {
        continue;
      }
      if (field.startsWith(JOURNAL_SEMANTIC_META_PREFIX)) {
        semanticFingerprints.set(
          field.slice(JOURNAL_SEMANTIC_META_PREFIX.length),
          value
        );
        continue;
      }
      if (field.startsWith(JOURNAL_LINEAGE_META_PREFIX)) {
        lineageFingerprints.set(
          field.slice(JOURNAL_LINEAGE_META_PREFIX.length),
          value
        );
        continue;
      }
      if (field !== 'primary' && !field.startsWith('cleanup:')) {
        throw new WorkerLifecycleJournalError('unknown_field');
      }

      let parsed: IWorkerLifecycleQueueMessage;
      try {
        parsed = JSON.parse(value) as IWorkerLifecycleQueueMessage;
      } catch {
        throw new WorkerLifecycleJournalError('malformed_payload');
      }
      parsed = this.durablePayload(parsed);

      this.assertJournalPayloadShape(parsed, workerId, operationId);
      payloadFields.add(field);
      const semanticFingerprint = semanticFingerprints.get(field);
      const lineageFingerprint = lineageFingerprints.get(field);
      const computedSemanticFingerprint =
        workerLifecycleSemanticFingerprint(parsed);
      const computedLineageFingerprint =
        workerLifecyclePhaseLineageFingerprint(parsed);
      const fingerprintMismatch =
        Boolean(semanticFingerprint) !== Boolean(lineageFingerprint) ||
        (semanticFingerprint !== undefined &&
          semanticFingerprint !== computedSemanticFingerprint) ||
        (lineageFingerprint !== undefined &&
          lineageFingerprint !== computedLineageFingerprint);
      if (fingerprintMismatch) {
        let repairResult = await this.repairLegacySessionStorageMetadata({
          journalKey,
          field,
          serializedPayload: value,
          payload: parsed,
          storedSemanticFingerprint: semanticFingerprint,
          storedLineageFingerprint: lineageFingerprint,
        });
        if (repairResult === 'not_applicable') {
          repairResult = await this.repairMixedVersionWarmMetadata({
            journalKey,
            field,
            serializedPayload: value,
            payload: parsed,
            storedSemanticFingerprint: semanticFingerprint,
            storedLineageFingerprint: lineageFingerprint,
          });
        }
        if (repairResult === 'raced' && !repairRaceRetried) {
          return this.loadPreparedWithMixedVersionRepair(
            workerId,
            operationId,
            true
          );
        }
        if (repairResult !== 'repaired') {
          throw new WorkerLifecycleJournalError(
            repairResult === 'raced'
              ? 'fingerprint_repair_raced'
              : repairResult === 'locked'
                ? 'phase_upgrade_locked'
                : 'fingerprint_integrity_mismatch'
          );
        }
        semanticFingerprints.set(field, computedSemanticFingerprint);
        lineageFingerprints.set(field, computedLineageFingerprint);
      }

      if (field === 'primary') {
        if (parsed.action === 'cleanup_previous_runtime' || primary) {
          throw new WorkerLifecycleJournalError('primary_conflict');
        }
        primary = parsed;
        continue;
      }

      const expectedCleanupField = `cleanup:${parsed.server_id}:${
        parsed.worker_type_id ?? ''
      }`;
      if (
        parsed.action !== 'cleanup_previous_runtime' ||
        field !== expectedCleanupField
      ) {
        throw new WorkerLifecycleJournalError('cleanup_field_mismatch');
      }
      cleanup.push(parsed);
    }

    for (const field of [
      ...semanticFingerprints.keys(),
      ...lineageFingerprints.keys(),
    ]) {
      if (!payloadFields.has(field)) {
        throw new WorkerLifecycleJournalError('orphan_fingerprint_metadata');
      }
    }

    if (deletionProof) {
      if (primary || cleanup.length > 0) {
        throw new WorkerLifecycleJournalError('mixed_deletion_operation');
      }
      return [deletionProof];
    }

    if (cleanup.length > 1) {
      throw new WorkerLifecycleJournalError('multiple_cleanup_commands');
    }
    const cleanupMessage = cleanup[0];
    const destructivePostgresProviderResetPrimary = Boolean(
      primary &&
      this.isDestructivePostgresProviderReset(
        primary,
        primary.previous_worker_type_id !== undefined &&
          primary.previous_worker_type_id !== primary.worker_type_id
      )
    );
    const destructivePostgresProviderResetCleanupPair =
      this.isDestructivePostgresProviderResetCleanupPair(
        primary,
        cleanupMessage
      );
    const cleanupRequired =
      (primary?.source === 'worker_update' ||
        primary?.source === 'reset_connection') &&
      (primary.cleanup_previous_runtime_required === true ||
        (primary.cleanup_previous_runtime_required === undefined &&
          ((Boolean(primary.previous_server_id) &&
            primary.previous_server_id !== primary.server_id) ||
            (Boolean(primary.previous_worker_type_id) &&
              primary.previous_worker_type_id !== primary.worker_type_id))));
    if (cleanupRequired && !cleanupMessage) {
      throw new WorkerLifecycleJournalError('cleanup_primary_missing');
    }
    if (
      cleanupMessage?.source === 'worker_update' ||
      cleanupMessage?.source === 'reset_connection'
    ) {
      if (
        !primary ||
        primary.source !== cleanupMessage.source ||
        cleanupMessage.account_id !== primary.account_id ||
        cleanupMessage.worker_status_id !== EWorkerStatus.recreating ||
        primary.worker_status_id !== EWorkerStatus.recreating ||
        (!destructivePostgresProviderResetCleanupPair &&
          cleanupMessage.remove_session !== primary.remove_session) ||
        cleanupMessage.remove_volume !== primary.remove_volume ||
        cleanupMessage.previous_session_storage !==
          primary.previous_session_storage ||
        cleanupMessage.server_id !== primary.previous_server_id ||
        cleanupMessage.worker_type_id !== primary.previous_worker_type_id ||
        cleanupMessage.previous_server_id !== primary.previous_server_id ||
        cleanupMessage.previous_worker_type_id !==
          primary.previous_worker_type_id ||
        (destructivePostgresProviderResetPrimary &&
          !destructivePostgresProviderResetCleanupPair)
      ) {
        throw new WorkerLifecycleJournalError(
          'cleanup_primary_identity_mismatch'
        );
      }
    } else if (
      cleanupMessage &&
      (cleanupMessage.source !== 'plan_limit_enforcement' || primary)
    ) {
      throw new WorkerLifecycleJournalError('cleanup_primary_missing');
    }

    if (cleanupMessage) {
      payloads.push(cleanupMessage);
    }
    if (primary) {
      payloads.push(primary);
    }
    return payloads;
  }

  async redrivePrepared(
    workerId: string,
    operationId: string,
    debugTraceId?: string,
    redriveClaimToken?: string
  ): Promise<IWorkerLifecycleQueueMessage[]> {
    const prepared = await this.loadPrepared(workerId, operationId);
    if (prepared.length === 0) {
      return [];
    }

    const redriven: IWorkerLifecycleQueueMessage[] = [];
    for (const original of prepared) {
      const payload: IWorkerLifecycleQueueMessage = {
        ...original,
        ...(original.action === 'delete'
          ? {}
          : {
              request_id: uuidv7(),
              requested_at: currentTime(),
              ...(debugTraceId ? { debug_trace_id: debugTraceId } : {}),
            }),
        ...(redriveClaimToken
          ? { redrive_claim_token: redriveClaimToken }
          : {}),
      };
      await this.publish(payload);
      redriven.push(payload);
    }
    return redriven;
  }

  async loadPermanentDeletionProof(
    workerId: string,
    operationId: string
  ): Promise<IWorkerLifecycleQueueMessage | null> {
    const proof = await this.workerDeletionProofService.load(
      workerId,
      operationId
    );
    return proof ? this.durablePayload(proof) : null;
  }

  async listPendingPermanentDeletions(
    limit = 100
  ): Promise<IWorkerLifecycleQueueMessage[]> {
    return (await this.workerDeletionProofService.listPending(limit)).map(
      (payload) => this.durablePayload(payload)
    );
  }

  async completePermanentDeletionFinalization(
    workerId: string,
    accountId: string,
    operationId: string
  ): Promise<boolean> {
    return this.workerDeletionProofService.complete(
      workerId,
      accountId,
      operationId
    );
  }

  getNumPartitions(): number {
    return KAFKA_GLOBAL_TOPIC_CONFIG.numPartitions;
  }

  getReplicationFactor(): number {
    return KAFKA_GLOBAL_TOPIC_CONFIG.replicationFactor;
  }

  topic(): string {
    return this.kafkaServiceQueueService.workerLifecycleRequest();
  }

  async ensure(): Promise<void> {
    await this.kafkaService.createTopics(
      [this.topic()],
      this.getNumPartitions(),
      this.getReplicationFactor()
    );
  }

  async publish(payload: IWorkerLifecycleQueueMessage): Promise<void> {
    const headers: MessageHeader[] = [];
    const redriveClaimToken = payload.redrive_claim_token;
    const durablePayload = this.durablePayload(payload);

    try {
      await this.prepare(durablePayload);
      const authoritativePayload =
        await this.loadAuthoritativePreparedPayload(durablePayload);
      if (!authoritativePayload) {
        throw new WorkerLifecycleJournalError('authoritative_payload_missing');
      }
      const outboundPayload: IWorkerLifecycleQueueMessage = {
        ...authoritativePayload,
        ...(redriveClaimToken
          ? { redrive_claim_token: redriveClaimToken }
          : {}),
      };
      void this.connectionLifecycleDebugService.log(
        'manager.lifecycle_queue.publish',
        {
          trace_id: outboundPayload.debug_trace_id,
          layer: 'manager',
          worker_id: outboundPayload.worker_id,
          account_id: outboundPayload.account_id,
          worker_type_id: outboundPayload.worker_type_id,
          lifecycle_operation_id: outboundPayload.operation_id,
          action: outboundPayload.action,
          source: outboundPayload.source,
          topic: this.topic(),
        }
      );
      await this.streamProducerService.send(
        this.topic(),
        outboundPayload,
        outboundPayload.worker_id,
        headers
      );
      void this.connectionLifecycleDebugService.log(
        'manager.lifecycle_queue.published',
        {
          trace_id: outboundPayload.debug_trace_id,
          layer: 'manager',
          worker_id: outboundPayload.worker_id,
          account_id: outboundPayload.account_id,
          worker_type_id: outboundPayload.worker_type_id,
          lifecycle_operation_id: outboundPayload.operation_id,
          action: outboundPayload.action,
          source: outboundPayload.source,
          topic: this.topic(),
        }
      );
    } catch (error) {
      void this.connectionLifecycleDebugService.log(
        'manager.lifecycle_queue.publish_error',
        {
          trace_id: payload.debug_trace_id,
          layer: 'manager',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          action: payload.action,
          source: payload.source,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }
}
