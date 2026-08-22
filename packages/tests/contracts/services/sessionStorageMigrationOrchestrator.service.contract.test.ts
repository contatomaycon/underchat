import 'reflect-metadata';

import { SessionStorageMigrationOrchestratorService } from '@core/services/sessionStorageMigrationOrchestrator.service';
import type {
  ClaimedSessionStorageMigration,
  SessionStorageMigrationRepository,
} from '@core/repositories/config/SessionStorageMigration.repository';
import type { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import type { SessionStorageMigrationService } from '@core/services/sessionStorageMigration.service';
import type { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { workerLifecycleSemanticFingerprint } from '@core/common/functions/workerLifecycleSemanticFingerprint';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { createHash } from 'node:crypto';

const BASE_TIME = new Date('2026-08-15T04:00:00.000Z');

const migration = (
  state: ClaimedSessionStorageMigration['state'],
  overrides: Partial<ClaimedSessionStorageMigration> = {}
): ClaimedSessionStorageMigration =>
  ({
    migration_id: '019ff000-0000-7000-8000-000000000001',
    worker_id: '019ff000-0000-7000-8000-000000000002',
    account_id: '019ff000-0000-7000-8000-000000000003',
    provider: 'wwebjs',
    state,
    source_volume_name: 'legacy-volume',
    expected_phone: '556192037138',
    expected_identity_hash: null,
    source_runtime_generation: 9,
    target_runtime_generation: null,
    target_revision_id: null,
    checkpoint_checksum: null,
    checkpoint_size_bytes: null,
    checkpoint_record_count: null,
    attempt_count: 0,
    max_attempts: 3,
    attempt_started_at: null,
    attempt_deadline_at: null,
    next_attempt_at: BASE_TIME.toISOString(),
    claim_token: '019ff000-0000-7000-8000-000000000004',
    claim_expires_at: new Date(BASE_TIME.getTime() + 330_000).toISOString(),
    lifecycle_operation_id: null,
    source_volume_preserved: true,
    health_evidence: {},
    last_error_code: null,
    created_at: BASE_TIME.toISOString(),
    updated_at: BASE_TIME.toISOString(),
    target_validated_at: null,
    restored_at: null,
    volume_delete_requested_at: null,
    volume_deleted_at: null,
    completed_at: null,
    worker_type_id: EWorkerType.wwebjs,
    server_id: '019ff000-0000-7000-8000-000000000005',
    container_id: 'container-source',
    runtime_container_id: 'container-source',
    runtime_session_storage: EWorkerSessionStorage.legacy_volume,
    runtime_generation: 9,
    ...overrides,
  }) as ClaimedSessionStorageMigration;

const harness = (claimed: ClaimedSessionStorageMigration) => {
  const claimNext = jest
    .fn()
    .mockResolvedValueOnce(claimed)
    .mockResolvedValueOnce(null);
  const transition = jest.fn(async (...args: unknown[]) => {
    const state = args[2] as ClaimedSessionStorageMigration['state'][];
    const nextState = args[3] as ClaimedSessionStorageMigration['state'];
    const patch = (args[4] ?? {}) as Partial<ClaimedSessionStorageMigration>;
    return {
      ...claimed,
      ...patch,
      state: nextState,
      claim_token: null,
      claim_expires_at: null,
      updated_at: BASE_TIME.toISOString(),
      previous_expected_states: state,
    };
  });
  const repository = {
    claimNext,
    transition,
    validationFence: jest.fn(),
    finalizeRestoration: jest.fn(async () => ({
      ...claimed,
      state: 'restored',
      claim_token: null,
      claim_expires_at: null,
      restored_at: BASE_TIME.toISOString(),
    })),
    latest: jest.fn(async () => claimed),
    beginLifecycle: jest.fn(async () => ({
      ...claimed,
      state: 'cutting_over',
      lifecycle_operation_id: '019ff000-0000-7000-8000-000000000006',
      runtime_session_storage: EWorkerSessionStorage.postgres,
      runtime_generation: claimed.runtime_generation + 1,
    })),
  } as unknown as SessionStorageMigrationRepository;
  const grpc = {
    runtimeHealth: jest.fn(),
    recreateWorker: jest.fn(),
  } as unknown as WorkerGrpcClientService;
  const migrationService = {
    publishSummary: jest.fn(async () => undefined),
  } as unknown as SessionStorageMigrationService;
  const lifecycleQueue = {
    prepare: jest.fn(async () => undefined),
  } as unknown as WorkerLifecycleQueueService;

  return {
    service: new SessionStorageMigrationOrchestratorService(
      repository,
      grpc,
      migrationService,
      lifecycleQueue
    ),
    repository,
    grpc,
    transition,
    migrationService,
    lifecycleQueue,
  };
};

describe('SessionStorageMigrationOrchestratorService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(BASE_TIME);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('makes capture claimable immediately while keeping a two-boot migration watchdog', async () => {
    const current = migration('queued');
    const { service, repository, transition } = harness(current);

    await service.processPending();

    expect(repository.claimNext).toHaveBeenCalledWith(570);
    expect(transition).toHaveBeenCalledTimes(1);
    const patch = transition.mock.calls[0]?.[4] as Record<string, unknown>;
    expect(patch.attempt_started_at).toBe(BASE_TIME.toISOString());
    expect(patch.next_attempt_at).toBe(BASE_TIME.toISOString());
    expect(Date.parse(String(patch.attempt_deadline_at))).toBe(
      BASE_TIME.getTime() + 9 * 60 * 1_000
    );
  });

  it('retains the causal failure code after a safe legacy restoration', async () => {
    const current = migration('restoring', {
      attempt_count: 3,
      last_error_code: 'session_storage_migration_attempt_timeout',
      target_runtime_generation: 10,
    });
    const { service, repository, grpc, transition, migrationService } =
      harness(current);
    jest.mocked(repository.validationFence).mockResolvedValue({
      migration: current,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      worker_session_storage: EWorkerSessionStorage.legacy_volume,
      runtime_session_storage: EWorkerSessionStorage.legacy_volume,
      runtime_generation: 10,
      runtime_container_id: 'container-source',
      active_revision_id: null,
      session_provider: null,
      session_state: null,
      revision_status: null,
      revision_source: null,
      server_id: current.server_id,
    });
    jest.mocked(grpc.runtimeHealth).mockResolvedValue({
      worker_id: current.worker_id,
      worker_type_id: EWorkerType.wwebjs,
      runtime_generation: 10,
      session_storage: EWorkerSessionStorage.legacy_volume,
      authenticated: true,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      phone: current.expected_phone ?? undefined,
      connection_status: {
        provider: 'wwebjs',
        status: EWhatsappConnectionStatus.online,
        connected: true,
        authenticated: true,
        sessionValid: true,
        recoverable: false,
        qrAvailable: false,
        sequence: 1,
        changedAt: BASE_TIME.toISOString(),
      },
    });

    await service.processPending();

    expect(repository.finalizeRestoration).toHaveBeenCalledWith(
      current.migration_id,
      current.worker_id,
      current.claim_token
    );
    expect(transition).not.toHaveBeenCalled();
    expect(migrationService.publishSummary).toHaveBeenCalledWith(
      current.worker_id,
      expect.objectContaining({
        state: 'restored',
        last_error_code: current.last_error_code,
      })
    );
  });

  it('recreates a same-generation legacy source before terminal restoration', async () => {
    const current = migration('restoring', {
      attempt_count: 3,
      last_error_code: 'wwebjs_session_storage_migration_already_owned',
    });
    const { service, repository, grpc, transition, lifecycleQueue } =
      harness(current);
    jest.mocked(repository.validationFence).mockResolvedValue({
      migration: current,
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.wwebjs,
      worker_session_storage: EWorkerSessionStorage.legacy_volume,
      runtime_session_storage: EWorkerSessionStorage.legacy_volume,
      runtime_generation: current.source_runtime_generation,
      runtime_container_id: 'container-source',
      active_revision_id: null,
      session_provider: null,
      session_state: null,
      revision_status: null,
      revision_source: null,
      server_id: current.server_id,
    });
    jest.mocked(grpc.recreateWorker).mockResolvedValue(undefined);

    await service.processPending();

    expect(repository.finalizeRestoration).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
    expect(lifecycleQueue.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: current.worker_id,
        session_storage: EWorkerSessionStorage.legacy_volume,
        remove_session: false,
        remove_volume: false,
      })
    );
    expect(lifecycleQueue.prepare).toHaveBeenCalledWith(
      expect.not.objectContaining({
        previous_session_storage: expect.anything(),
        session_storage_migration_id: expect.anything(),
      })
    );
    expect(repository.beginLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        migrationId: current.migration_id,
        claimToken: current.claim_token,
        expectedStates: ['restoring'],
        state: 'restoring',
        targetStorage: EWorkerSessionStorage.legacy_volume,
        targetRuntimeGeneration: current.source_runtime_generation + 1,
      })
    );
    expect(grpc.recreateWorker).toHaveBeenCalledTimes(1);
  });

  it('terminalizes a restoration when the protected source volume is physically missing', async () => {
    const current = migration('restoring', {
      attempt_count: 3,
      source_volume_preserved: true,
      target_runtime_generation: 10,
      runtime_session_storage: EWorkerSessionStorage.postgres,
      runtime_generation: 10,
    });
    const { service, repository, grpc, transition, migrationService } =
      harness(current);
    jest.mocked(repository.validationFence).mockResolvedValue({
      migration: current,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      worker_session_storage: EWorkerSessionStorage.legacy_volume,
      runtime_session_storage: EWorkerSessionStorage.postgres,
      runtime_generation: 10,
      runtime_container_id: null,
      active_revision_id: null,
      session_provider: 'wwebjs',
      session_state: 'preparing',
      revision_status: 'staging',
      revision_source: 'legacy_volume_migration',
      server_id: current.server_id,
    });
    jest
      .mocked(grpc.recreateWorker)
      .mockRejectedValue(
        new Error(
          '13 INTERNAL: session_storage_migration_source_volume_missing'
        )
      );

    await service.processPending();

    expect(grpc.recreateWorker).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(
      current.migration_id,
      null,
      ['restoring'],
      'recovery_required',
      {
        next_attempt_at: null,
        source_volume_preserved: false,
        last_error_code: 'session_storage_migration_source_volume_missing',
      }
    );
    expect(migrationService.publishSummary).toHaveBeenCalledWith(
      current.worker_id,
      expect.objectContaining({
        state: 'recovery_required',
        source_volume_preserved: false,
        next_attempt_at: null,
        last_error_code: 'session_storage_migration_source_volume_missing',
      })
    );
  });

  it('finalizes the promoted PostgreSQL revision with migration identity but without legacy volume metadata', async () => {
    const phone = '556192037138';
    const current = migration('validating', {
      checkpoint_checksum: 'a'.repeat(64),
      expected_phone: phone,
      expected_identity_hash: createHash('sha256')
        .update(phone, 'utf8')
        .digest('hex'),
      attempt_count: 1,
      attempt_started_at: BASE_TIME.toISOString(),
      attempt_deadline_at: new Date(
        BASE_TIME.getTime() + 5 * 60 * 1_000
      ).toISOString(),
      target_runtime_generation: 10,
      runtime_session_storage: EWorkerSessionStorage.postgres,
      runtime_generation: 10,
    });
    const { service, repository, grpc, lifecycleQueue } = harness(current);
    jest.mocked(repository.validationFence).mockResolvedValue({
      migration: current,
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.wwebjs,
      worker_session_storage: EWorkerSessionStorage.postgres,
      runtime_session_storage: EWorkerSessionStorage.postgres,
      runtime_generation: 10,
      runtime_container_id: 'container-target',
      active_revision_id: 42,
      session_provider: 'wwebjs',
      session_state: 'ready',
      revision_status: 'active',
      revision_source: 'legacy_volume_migration',
      server_id: current.server_id,
    });
    jest.mocked(grpc.runtimeHealth).mockResolvedValue({
      worker_id: current.worker_id,
      worker_type_id: EWorkerType.wwebjs,
      runtime_generation: 10,
      session_storage: EWorkerSessionStorage.postgres,
      session_storage_migration_id: current.migration_id,
      session_revision_id: 42,
      authenticated: true,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      phone,
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: true,
      command_ingress_ready: true,
      command_ingress_authorized: true,
      connection_status: {
        provider: 'wwebjs',
        status: EWhatsappConnectionStatus.online,
        connected: true,
        authenticated: true,
        sessionValid: true,
        recoverable: false,
        qrAvailable: false,
        sequence: 2,
        changedAt: BASE_TIME.toISOString(),
      },
    });
    jest.mocked(grpc.recreateWorker).mockResolvedValue(undefined);

    await service.processPending();

    expect(lifecycleQueue.prepare).toHaveBeenCalledTimes(1);
    const journal = jest.mocked(lifecycleQueue.prepare).mock.calls[0]?.[0];
    if (!journal) throw new Error('finalization journal was not prepared');
    expect(journal).toMatchObject({
      action: 'recreate',
      source: 'worker_update',
      session_storage: EWorkerSessionStorage.postgres,
      session_storage_migration_id: current.migration_id,
      remove_session: false,
      remove_volume: false,
    });
    expect(journal.previous_session_storage).toBeUndefined();
    expect(journal.legacy_session_volume_name).toBeUndefined();
    expect(journal.legacy_session_checksum).toBeUndefined();
    const command = jest.mocked(grpc.recreateWorker).mock.calls[0]?.[0];
    expect(command).toMatchObject({
      session_storage: EWorkerSessionStorage.postgres,
      session_storage_migration_id: current.migration_id,
      lifecycle_semantic_fingerprint:
        workerLifecycleSemanticFingerprint(journal),
    });
    expect(command?.previous_session_storage).toBeUndefined();
    expect(command?.legacy_session_volume_name).toBeUndefined();
    expect(command?.legacy_session_checksum).toBeUndefined();
    expect(repository.beginLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        migrationId: current.migration_id,
        expectedStates: ['validating'],
        targetStorage: EWorkerSessionStorage.postgres,
        targetRuntimeGeneration: 11,
        targetRevisionId: 42,
      })
    );
  });

  it('rechecks a fenced transient target without consuming another migration attempt', async () => {
    const phone = '556192037138';
    const current = migration('validating', {
      expected_phone: phone,
      expected_identity_hash: createHash('sha256')
        .update(phone, 'utf8')
        .digest('hex'),
      attempt_count: 1,
      attempt_started_at: BASE_TIME.toISOString(),
      attempt_deadline_at: new Date(
        BASE_TIME.getTime() + 9 * 60 * 1_000
      ).toISOString(),
      target_runtime_generation: 10,
      target_revision_id: 42,
      runtime_session_storage: EWorkerSessionStorage.postgres,
      runtime_generation: 10,
    });
    const { service, repository, grpc, transition } = harness(current);
    jest.mocked(repository.validationFence).mockResolvedValue({
      migration: current,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      worker_session_storage: EWorkerSessionStorage.postgres,
      runtime_session_storage: EWorkerSessionStorage.postgres,
      runtime_generation: 10,
      runtime_container_id: 'container-target',
      active_revision_id: 42,
      session_provider: 'wwebjs',
      session_state: 'ready',
      revision_status: 'active',
      revision_source: 'legacy_volume_migration',
      server_id: current.server_id,
    });
    jest.mocked(grpc.runtimeHealth).mockResolvedValue({
      worker_id: current.worker_id,
      worker_type_id: EWorkerType.wwebjs,
      runtime_generation: 10,
      session_storage: EWorkerSessionStorage.postgres,
      session_storage_migration_id: current.migration_id,
      session_revision_id: 42,
      authenticated: false,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      phone,
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: true,
      command_ingress_ready: true,
      command_ingress_authorized: true,
      connection_status: {
        provider: 'wwebjs',
        status: EWhatsappConnectionStatus.handoff,
        connected: false,
        authenticated: false,
        sessionValid: null,
        recoverable: true,
        qrAvailable: false,
        sequence: 3,
        changedAt: BASE_TIME.toISOString(),
        reason: 'handoff_validation',
      },
    });

    await service.processPending();

    expect(repository.latest).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(
      current.migration_id,
      current.claim_token,
      ['validating'],
      'validating',
      expect.objectContaining({
        next_attempt_at: new Date(BASE_TIME.getTime() + 5_000).toISOString(),
        last_error_code: null,
      })
    );
    expect(transition.mock.calls[0]?.[4]).not.toHaveProperty('attempt_count');
  });

  it('fails closed instead of rechecking a terminal target session', async () => {
    const current = migration('validating', {
      attempt_count: 1,
      attempt_started_at: BASE_TIME.toISOString(),
      attempt_deadline_at: new Date(
        BASE_TIME.getTime() + 9 * 60 * 1_000
      ).toISOString(),
      target_runtime_generation: 10,
      target_revision_id: 42,
      runtime_session_storage: EWorkerSessionStorage.postgres,
      runtime_generation: 10,
    });
    const { service, repository, grpc, transition } = harness(current);
    jest.mocked(repository.validationFence).mockResolvedValue({
      migration: current,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      worker_session_storage: EWorkerSessionStorage.postgres,
      runtime_session_storage: EWorkerSessionStorage.postgres,
      runtime_generation: 10,
      runtime_container_id: 'container-target',
      active_revision_id: 42,
      session_provider: 'wwebjs',
      session_state: 'ready',
      revision_status: 'active',
      revision_source: 'legacy_volume_migration',
      server_id: current.server_id,
    });
    jest.mocked(grpc.runtimeHealth).mockResolvedValue({
      worker_id: current.worker_id,
      worker_type_id: EWorkerType.wwebjs,
      runtime_generation: 10,
      session_storage: EWorkerSessionStorage.postgres,
      session_storage_migration_id: current.migration_id,
      session_revision_id: 42,
      authenticated: false,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      phone: current.expected_phone ?? undefined,
      connection_status: {
        provider: 'wwebjs',
        status: EWhatsappConnectionStatus.loggedOut,
        connected: false,
        authenticated: false,
        sessionValid: false,
        recoverable: false,
        qrAvailable: false,
        sequence: 4,
        changedAt: BASE_TIME.toISOString(),
        reason: 'logged_out',
      },
    });

    await service.processPending();

    expect(repository.latest).toHaveBeenCalledWith(current.worker_id);
    expect(transition).toHaveBeenCalledWith(
      current.migration_id,
      null,
      ['validating'],
      'retry_wait',
      expect.objectContaining({
        last_error_code: 'session_storage_migration_target_not_ready',
      })
    );
  });

  it('persists and fingerprints the lifecycle command before claiming the cutover', async () => {
    const current = migration('staged', {
      checkpoint_checksum: 'a'.repeat(64),
      checkpoint_size_bytes: 42,
      checkpoint_record_count: 3,
      attempt_count: 1,
      attempt_started_at: BASE_TIME.toISOString(),
      attempt_deadline_at: new Date(
        BASE_TIME.getTime() + 5 * 60 * 1_000
      ).toISOString(),
    });
    const { service, repository, grpc, lifecycleQueue } = harness(current);
    jest.mocked(grpc.recreateWorker).mockResolvedValue(undefined);

    await service.processPending();

    expect(lifecycleQueue.prepare).toHaveBeenCalledTimes(1);
    const journal = jest.mocked(lifecycleQueue.prepare).mock.calls[0]?.[0];
    if (!journal) throw new Error('lifecycle journal was not prepared');
    expect(journal).toMatchObject({
      action: 'recreate',
      worker_id: current.worker_id,
      account_id: current.account_id,
      source: 'worker_update',
      session_storage: EWorkerSessionStorage.postgres,
      previous_session_storage: EWorkerSessionStorage.legacy_volume,
      session_storage_migration_id: current.migration_id,
      legacy_session_volume_name: current.source_volume_name,
      legacy_session_checksum: current.checkpoint_checksum,
      remove_session: false,
      remove_volume: false,
    });
    const command = jest.mocked(grpc.recreateWorker).mock.calls[0]?.[0];
    expect(command?.lifecycle_semantic_fingerprint).toBe(
      workerLifecycleSemanticFingerprint(journal)
    );
    const prepareOrder = jest.mocked(lifecycleQueue.prepare).mock
      .invocationCallOrder[0];
    const beginOrder = jest.mocked(repository.beginLifecycle).mock
      .invocationCallOrder[0];
    expect(prepareOrder).toBeDefined();
    expect(beginOrder).toBeDefined();
    if (prepareOrder === undefined || beginOrder === undefined) {
      throw new Error('lifecycle call ordering was not observed');
    }
    expect(prepareOrder).toBeLessThan(beginOrder);
  });

  it.each([
    ['baileys', EWorkerType.baileys],
    ['wwebjs', EWorkerType.wwebjs],
    ['whatsmeow', EWorkerType.whatsmeow],
  ] as const)(
    'preserves the immutable legacy-to-PostgreSQL direction when redriving a %s cutover after the live runtime already changed',
    async (provider, workerTypeId) => {
      const current = migration('cutting_over', {
        provider,
        worker_type_id: workerTypeId,
        checkpoint_checksum: 'b'.repeat(64),
        attempt_count: 2,
        attempt_started_at: BASE_TIME.toISOString(),
        attempt_deadline_at: new Date(
          BASE_TIME.getTime() + 5 * 60 * 1_000
        ).toISOString(),
        lifecycle_operation_id: '019ff000-0000-7000-8000-000000000006',
        // This partial-cutover view previously corrupted the redrive into a
        // postgres -> postgres command with protected migration metadata.
        runtime_session_storage: EWorkerSessionStorage.postgres,
        runtime_generation: 10,
      });
      const { service, grpc, lifecycleQueue, transition } = harness(current);
      jest.mocked(grpc.recreateWorker).mockResolvedValue(undefined);

      await service.processPending();

      expect(lifecycleQueue.prepare).toHaveBeenCalledTimes(1);
      const journal = jest.mocked(lifecycleQueue.prepare).mock.calls[0]?.[0];
      if (!journal) throw new Error('lifecycle journal was not prepared');
      expect(journal).toMatchObject({
        operation_id: current.lifecycle_operation_id,
        worker_type_id: workerTypeId,
        previous_worker_type_id: workerTypeId,
        session_storage: EWorkerSessionStorage.postgres,
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
        session_storage_migration_id: current.migration_id,
        legacy_session_volume_name: current.source_volume_name,
        legacy_session_checksum: current.checkpoint_checksum,
        remove_session: false,
        remove_volume: false,
      });
      const command = jest.mocked(grpc.recreateWorker).mock.calls[0]?.[0];
      expect(command?.lifecycle_semantic_fingerprint).toBe(
        workerLifecycleSemanticFingerprint(journal)
      );
      expect(transition).toHaveBeenCalledWith(
        current.migration_id,
        current.claim_token,
        ['cutting_over'],
        'starting',
        expect.objectContaining({ next_attempt_at: expect.any(String) })
      );
    }
  );

  it.each([
    ['baileys', EWorkerType.baileys],
    ['wwebjs', EWorkerType.wwebjs],
    ['whatsmeow', EWorkerType.whatsmeow],
  ] as const)(
    'preserves the immutable legacy-to-PostgreSQL direction when a %s retry re-enters through staged with a new operation',
    async (provider, workerTypeId) => {
      const current = migration('staged', {
        provider,
        worker_type_id: workerTypeId,
        checkpoint_checksum: 'c'.repeat(64),
        checkpoint_size_bytes: 84,
        checkpoint_record_count: 6,
        attempt_count: 2,
        attempt_started_at: BASE_TIME.toISOString(),
        attempt_deadline_at: new Date(
          BASE_TIME.getTime() + 5 * 60 * 1_000
        ).toISOString(),
        runtime_session_storage: EWorkerSessionStorage.postgres,
        runtime_generation: 10,
      });
      const { service, grpc, lifecycleQueue } = harness(current);
      jest.mocked(grpc.recreateWorker).mockResolvedValue(undefined);

      await service.processPending();

      expect(lifecycleQueue.prepare).toHaveBeenCalledTimes(1);
      const journal = jest.mocked(lifecycleQueue.prepare).mock.calls[0]?.[0];
      if (!journal) throw new Error('lifecycle journal was not prepared');
      expect(journal).toMatchObject({
        worker_type_id: workerTypeId,
        previous_worker_type_id: workerTypeId,
        session_storage: EWorkerSessionStorage.postgres,
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
        session_storage_migration_id: current.migration_id,
        legacy_session_volume_name: current.source_volume_name,
        legacy_session_checksum: current.checkpoint_checksum,
        remove_session: false,
        remove_volume: false,
      });
      const command = jest.mocked(grpc.recreateWorker).mock.calls[0]?.[0];
      expect(command?.lifecycle_semantic_fingerprint).toBe(
        workerLifecycleSemanticFingerprint(journal)
      );
      expect(journal.operation_id).not.toBe(current.lifecycle_operation_id);
    }
  );
});
