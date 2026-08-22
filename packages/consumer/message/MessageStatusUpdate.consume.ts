import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import type { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { MessageStatusService } from '@core/services/messageStatus.service';
import { MessageStatusPendingService } from '@core/services/messageStatusPending.service';
import Redis from 'ioredis';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import type {
  KafkaConsumerEffectLease,
  KafkaConsumerEffectLeaseFailureRecoveryDecision,
  KafkaConsumerRunnerContext,
} from '@core/common/interfaces/KafkaConsumerRunnerOptions';
import { WhatsappRuntimeFenceService } from '@core/services/whatsappRuntimeFence.service';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import {
  buildMessageStatusEventId,
  canonicalMessageStatusMessageId,
  ensureMessageStatusEventId,
} from '@core/common/functions/messageStatusIdentity';
import { randomUUID } from 'node:crypto';
import { SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS } from '@core/common/functions/serviceApiWhatsappConsumerBindings';
import {
  isCriticalRedisOperationError,
  runCriticalRedisOperation,
} from '@core/common/functions/criticalRedisOperation';
import {
  acquireReboundAuxiliaryRuntimeLease,
  isAuxiliaryRuntimeLeaseRaceError,
  isUnrecoverableAuxiliaryRuntimeEventError,
} from '@core/consumer/auxiliaryRuntimeRebind';
import { OfficialWhatsappConversationWindowService } from '@core/services/officialWhatsappConversationWindow.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';

interface AssignmentEpochConsumer extends KafkaConsumer {
  __isAssignmentEpochActive?: (
    topic: string,
    partition: number,
    epoch: number
  ) => boolean;
  __health?: () => {
    assignment_epoch?: number;
    assignments?: Array<{
      topic: string;
      partition: number;
    }>;
  };
}

type PendingAssignmentDecision = 'claim' | 'discard' | 'ignore';

interface OfficialWindowStatusReconciler {
  recordProviderAcceptedMessage(
    message: IChatMessage,
    providerMessageId?: string | null
  ): Promise<void>;
  recordTemplateFailureForMessage(
    message: IChatMessage,
    errorCode?: number | null,
    providerMessageId?: string | null
  ): Promise<void>;
  recordTemplateUncertainForMessage(
    message: IChatMessage,
    providerMessageId?: string | null
  ): Promise<void>;
}

@singleton()
export class MessageStatusUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IMessageStatusUpdate> | null = null;
  private isRunning = false;
  private readonly idempotencyTtlSeconds = 60 * 60 * 24 * 30;
  private readonly idempotencyPrefix = 'status-update:v2:';
  private readonly missingStatusRetryIntervalMs = 1_000;
  private readonly missingStatusRetryMaxBackoffMs = 30_000;
  private readonly missingStatusRetryJitterMs = 250;
  private missingStatusRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private missingStatusRetryInFlight: Promise<void> | null = null;
  private missingStatusRetryFailureCount = 0;
  private missingStatusRetryLastErrorLogAt = 0;
  private readonly runtimeFence: WhatsappRuntimeFenceService;
  private readonly consumerInstanceId = randomUUID();
  private readonly pendingClaimOwnerId = randomUUID();

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(MessageStatusService)
    private readonly messageStatusService: MessageStatusService,
    @inject(MessageStatusPendingService)
    private readonly messageStatusPendingService: MessageStatusPendingService,
    @inject(OfficialWhatsappConversationWindowService)
    private readonly officialWindowService: OfficialWindowStatusReconciler,
    @inject('Redis') private readonly redis: Redis
  ) {
    this.runtimeFence = new WhatsappRuntimeFenceService(this.redis);
  }

  private parseMessage(value: Buffer | null): IMessageStatusUpdate | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IMessageStatusUpdate;
      if (!parsed) return null;
      const declaresPortableTerminalSchema =
        parsed.terminal_failure_schema ===
          'message_send_terminal_failure_recovery_v1' ||
        parsed.terminal_failure_schema === 'message_send_ambiguous_terminal_v1';
      if (!declaresPortableTerminalSchema || parsed.event_id?.trim()) {
        ensureMessageStatusEventId(parsed);
      }

      return parsed;
    } catch {
      return null;
    }
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.updateMessageStatus();
    await this.runStatusRedisOperation('discard_legacy_pending', () =>
      this.messageStatusPendingService.discardLegacyPendingStatuses()
    );
    this.runner = new KafkaConsumerRunner<IMessageStatusUpdate>({
      kafka: this.kafka,
      topic,
      groupId: SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS.messageStatusUpdate,
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) =>
        this.getMessageKey(data.account_id, data.message_id, data.worker_id),
      preserveEntityOrder: true,
      acquireEffectLease: (data) => this.acquireStatusEffectLease(data),
      recoverEffectLeaseAcquisitionFailure: (data, context, error) =>
        this.recoverStatusEffectLeaseAcquisitionFailure(data, context, error),
      classifyEffectLeaseRejection: () => 'retry' as const,
      shouldContinueRetryWithoutCommit: (_data, _context, error) =>
        isAuxiliaryRuntimeLeaseRaceError(error) ||
        isCriticalRedisOperationError(error),
      classifyError: (_data, _context, error) =>
        this.isUnrecoverableStatusRuntimeError(error)
          ? 'terminal'
          : 'retryable',
      handle: async (data, context) => {
        context.assertActive();
        await this.processStatusUpdate(
          {
            ...data,
            consumer_assignment_owner: this.consumerInstanceId,
            consumer_assignment_epoch: context.message.consumerAssignmentEpoch,
            consumer_partition: context.partition,
          },
          context.assertActive,
          true
        );
      },
      logger: console,
    });

    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
    this.startMissingStatusRetryWorker();
  }

  public async close(): Promise<void> {
    if (this.missingStatusRetryTimer) {
      clearTimeout(this.missingStatusRetryTimer);
      this.missingStatusRetryTimer = null;
    }

    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
    await this.missingStatusRetryInFlight?.catch(() => undefined);
  }

  private startMissingStatusRetryWorker(): void {
    if (this.missingStatusRetryTimer) {
      clearTimeout(this.missingStatusRetryTimer);
      this.missingStatusRetryTimer = null;
    }
    this.missingStatusRetryFailureCount = 0;
    this.scheduleMissingStatusRetry(this.nextMissingStatusRetryDelayMs(false));
  }

  private scheduleMissingStatusRetry(delayMs: number): void {
    if (
      !this.isRunning ||
      this.missingStatusRetryTimer ||
      this.missingStatusRetryInFlight
    ) {
      return;
    }

    this.missingStatusRetryTimer = setTimeout(
      () => {
        this.missingStatusRetryTimer = null;
        const operation = this.processDuePendingStatuses()
          .then(() => {
            this.missingStatusRetryFailureCount = 0;
            this.missingStatusRetryLastErrorLogAt = 0;
          })
          .catch((error) => {
            this.missingStatusRetryFailureCount += 1;
            const now = Date.now();
            if (
              this.missingStatusRetryLastErrorLogAt === 0 ||
              now - this.missingStatusRetryLastErrorLogAt >= 30_000
            ) {
              this.missingStatusRetryLastErrorLogAt = now;
              console.error(
                '[MessageStatusUpdateConsume] pending-status recovery tick failed; retrying on the next tick',
                error
              );
            }
          })
          .finally(() => {
            if (this.missingStatusRetryInFlight === operation) {
              this.missingStatusRetryInFlight = null;
            }
            if (this.isRunning) {
              this.scheduleMissingStatusRetry(
                this.nextMissingStatusRetryDelayMs(
                  this.missingStatusRetryFailureCount > 0
                )
              );
            }
          });
        this.missingStatusRetryInFlight = operation;
      },
      Math.max(1, delayMs)
    );

    this.missingStatusRetryTimer.unref?.();
  }

  private nextMissingStatusRetryDelayMs(afterFailure: boolean): number {
    const baseDelayMs = afterFailure
      ? Math.min(
          this.missingStatusRetryMaxBackoffMs,
          this.missingStatusRetryIntervalMs *
            2 ** Math.min(this.missingStatusRetryFailureCount, 5)
        )
      : this.missingStatusRetryIntervalMs;
    return (
      baseDelayMs +
      Math.floor(Math.random() * (this.missingStatusRetryJitterMs + 1))
    );
  }

  private async processDuePendingStatuses(): Promise<void> {
    /*
     * This is a background single-flight, not a Kafka dispatch. A Promise.race
     * timeout cannot cancel an ioredis command and used to abandon the eventual
     * claim result, start another sweep, and amplify Redis load. Keep the real
     * operation attached until it settles; the scheduler applies backoff after
     * a genuine rejection and shutdown still has its process-level deadline.
     */
    const pendingStatuses =
      await this.messageStatusPendingService.claimDuePendingStatuses({
        ownerId: this.pendingClaimOwnerId,
        decideClaim: (data) => this.pendingAssignmentDecision(data),
      });

    await Promise.all(
      pendingStatuses.map(async (data) => {
        if (!this.isPendingAssignmentActive(data)) {
          await this.requeuePendingAfterRuntimeAdmissionFailure(data);
          return;
        }

        let effectLease: KafkaConsumerEffectLease | null;
        try {
          effectLease = await this.acquireStatusEffectLease(data);
        } catch (error) {
          if (this.isUnrecoverableStatusRuntimeError(error)) {
            await this.runStatusRedisOperation(
              'discard_invalid_pending_claim',
              () =>
                this.messageStatusPendingService.discardClaimedPendingStatus(
                  data
                )
            );
            return;
          }
          await this.requeuePendingAfterRuntimeAdmissionFailure(data);
          return;
        }
        if (!effectLease) {
          await this.requeuePendingAfterRuntimeAdmissionFailure(data);
          return;
        }
        try {
          await this.processPendingStatus(
            data,
            () => {
              if (!this.isPendingAssignmentActive(data)) {
                throw new KafkaConsumerDispatchRevokedError();
              }
              effectLease.assertOwned();
            },
            true
          );
        } finally {
          await effectLease.release().catch((error) => {
            console.error(
              '[MessageStatusUpdateConsume] failed to release pending-status runtime effect lease',
              error
            );
          });
        }
      })
    );
  }

  private async isRuntimeCurrent(data: IMessageStatusUpdate): Promise<boolean> {
    if (!this.requiresRuntimeFence(data)) {
      return true;
    }
    return this.runStatusRedisOperation('runtime_fence_current', () =>
      this.runtimeFence.isCurrent(data)
    );
  }

  private requiresRuntimeFence(data: IMessageStatusUpdate): boolean {
    return !this.isPortableDurableTerminalStatus(data);
  }

  private isPortableDurableTerminalStatus(data: IMessageStatusUpdate): boolean {
    const internalMessageId = data.internal_message_id?.trim();
    const messageId = data.message_id?.trim();
    const isManagedTerminalProvider =
      data.source_provider === 'baileys' ||
      data.source_provider === 'wwebjs' ||
      data.source_provider === 'whatsmeow' ||
      data.source_provider === 'official_whatsapp';
    const hasCanonicalTerminalIdentity =
      Boolean(internalMessageId) &&
      internalMessageId === messageId &&
      Boolean(data.event_id?.trim()) &&
      data.event_id?.trim() === buildMessageStatusEventId(data) &&
      Object.keys(data.patch ?? {}).length === 0;
    const isDurablePreProviderTerminalFailure =
      data.failed === true &&
      data.ambiguous !== true &&
      data.terminal_failure_schema ===
        'message_send_terminal_failure_recovery_v1' &&
      isManagedTerminalProvider &&
      hasCanonicalTerminalIdentity;
    const isDurableAmbiguousTerminal =
      data.failed === true &&
      data.ambiguous === true &&
      data.terminal_failure_schema === 'message_send_ambiguous_terminal_v1' &&
      isManagedTerminalProvider &&
      hasCanonicalTerminalIdentity;
    return isDurablePreProviderTerminalFailure || isDurableAmbiguousTerminal;
  }

  private async acquireStatusEffectLease(
    data: IMessageStatusUpdate
  ): Promise<KafkaConsumerEffectLease | null> {
    if (!this.requiresRuntimeFence(data)) {
      return {
        assertOwned: () => undefined,
        release: async () => undefined,
      };
    }
    /*
     * The runtime-fence service already bounds the actual Redis reads and
     * lease acquisition with runCriticalRedisOperation. Keep the composite
     * admission helper outside another critical wrapper so domain decisions
     * such as provider mismatch, tombstones, and cutover races preserve their
     * own error types instead of being mislabeled as Redis outages.
     */
    return acquireReboundAuxiliaryRuntimeLease(
      data,
      this.runtimeFence,
      (candidate) => this.isImmutableStatusIdentityValid(candidate)
    );
  }

  private async recoverStatusEffectLeaseAcquisitionFailure(
    data: IMessageStatusUpdate,
    context: KafkaConsumerRunnerContext<IMessageStatusUpdate>,
    error: unknown
  ): Promise<KafkaConsumerEffectLeaseFailureRecoveryDecision> {
    if (!isAuxiliaryRuntimeLeaseRaceError(error)) {
      return 'retry';
    }

    const assignmentEpoch = context.message.consumerAssignmentEpoch;
    if (
      typeof assignmentEpoch !== 'number' ||
      !Number.isSafeInteger(assignmentEpoch)
    ) {
      throw new KafkaConsumerDispatchRevokedError();
    }

    context.assertActive();
    const pendingStatus: IMessageStatusUpdate = {
      ...data,
      consumer_assignment_owner: this.consumerInstanceId,
      consumer_assignment_epoch: assignmentEpoch,
      consumer_partition: context.partition,
    };
    await this.runStatusRedisOperation('runtime_lease_race_handoff', () =>
      this.messageStatusPendingService.reschedulePendingStatus(
        pendingStatus,
        {
          batchSize: 1,
          duration: 0,
        },
        {
          incrementRetry: false,
        }
      )
    );
    context.assertActive();
    context.reportProgress?.();
    context.assertActive();
    return 'durable_handoff';
  }

  private isImmutableStatusIdentityValid(data: IMessageStatusUpdate): boolean {
    const expectedEventId = buildMessageStatusEventId(data);
    const provider = data.source_provider?.trim();
    return (
      Boolean(data.account_id?.trim()) &&
      Boolean(data.worker_id?.trim()) &&
      (provider === 'baileys' ||
        provider === 'wwebjs' ||
        provider === 'whatsmeow' ||
        provider === 'official_whatsapp') &&
      Boolean(canonicalMessageStatusMessageId(data.message_id)) &&
      expectedEventId !== null &&
      data.event_id?.trim() === expectedEventId
    );
  }

  private isUnrecoverableStatusRuntimeError(error: unknown): boolean {
    return (
      isUnrecoverableAuxiliaryRuntimeEventError(error) ||
      (isCriticalRedisOperationError(error) &&
        isUnrecoverableAuxiliaryRuntimeEventError(error.cause))
    );
  }

  private async requeuePendingAfterRuntimeAdmissionFailure(
    data: IMessageStatusUpdate
  ): Promise<void> {
    await this.runStatusRedisOperation(
      'requeue_pending_after_runtime_admission',
      () =>
        this.messageStatusPendingService.reschedulePendingStatus(
          data,
          {
            batchSize: 1,
            duration: 0,
          },
          {
            incrementRetry: false,
          }
        )
    );
  }

  private isPendingAssignmentActive(data: IMessageStatusUpdate): boolean {
    if (this.isPortableDurableTerminalStatus(data)) {
      return (
        data.pending_claim_owner?.trim() === this.pendingClaimOwnerId ||
        this.ownsPendingPartition(data)
      );
    }
    if (
      data.consumer_assignment_owner?.trim() !== this.consumerInstanceId ||
      !this.ownsPendingPartition(data)
    ) {
      return false;
    }

    const epoch = data.consumer_assignment_epoch;
    const partition = data.consumer_partition;
    if (
      typeof epoch !== 'number' ||
      !Number.isFinite(epoch) ||
      typeof partition !== 'number' ||
      !Number.isFinite(partition)
    ) {
      return false;
    }

    const consumer = this.consumer as AssignmentEpochConsumer | null;
    return (
      consumer?.__isAssignmentEpochActive?.(
        this.kafkaServiceQueueService.updateMessageStatus(),
        partition,
        epoch
      ) === true
    );
  }

  private pendingAssignmentDecision(
    data: IMessageStatusUpdate
  ): PendingAssignmentDecision {
    if (!this.ownsPendingPartition(data)) {
      return 'ignore';
    }
    if (this.isPortableDurableTerminalStatus(data)) {
      return 'claim';
    }

    if (!this.isImmutableStatusIdentityValid(data)) {
      return 'discard';
    }

    const assignmentEpoch = this.currentPendingAssignmentEpoch(
      data.consumer_partition
    );
    if (assignmentEpoch === null) {
      return 'ignore';
    }
    data.consumer_assignment_owner = this.consumerInstanceId;
    data.consumer_assignment_epoch = assignmentEpoch;
    return 'claim';
  }

  private currentPendingAssignmentEpoch(partition?: number): number | null {
    if (
      typeof partition !== 'number' ||
      !Number.isFinite(partition) ||
      !this.consumer
    ) {
      return null;
    }
    const consumer = this.consumer as AssignmentEpochConsumer;
    const epoch = consumer.__health?.().assignment_epoch;
    if (
      typeof epoch !== 'number' ||
      !Number.isFinite(epoch) ||
      consumer.__isAssignmentEpochActive?.(
        this.kafkaServiceQueueService.updateMessageStatus(),
        partition,
        epoch
      ) !== true
    ) {
      return null;
    }
    return epoch;
  }

  private ownsPendingPartition(data: IMessageStatusUpdate): boolean {
    const partition = data.consumer_partition;
    if (
      typeof partition !== 'number' ||
      !Number.isFinite(partition) ||
      !this.consumer
    ) {
      return false;
    }

    const topic = this.kafkaServiceQueueService.updateMessageStatus();
    const assignments = (this.consumer as AssignmentEpochConsumer).__health?.()
      .assignments;
    return (
      assignments?.some(
        (assignment) =>
          assignment.topic === topic && assignment.partition === partition
      ) === true
    );
  }

  private async processPendingStatus(
    data: IMessageStatusUpdate,
    assertActive: () => void = () => undefined,
    runtimeLeaseOwned = false
  ): Promise<void> {
    try {
      await this.messageStatusPendingService.withClaimHeartbeat(
        data,
        async (assertClaimActive) => {
          await this.processPendingStatusWithClaim(
            data,
            assertActive,
            assertClaimActive,
            runtimeLeaseOwned
          );
        }
      );
    } catch (error) {
      if (this.isPendingClaimLeaseLost(error)) {
        return;
      }
      throw error;
    }
  }

  private async processPendingStatusWithClaim(
    data: IMessageStatusUpdate,
    assertAssignmentActive: () => void,
    assertClaimActive: () => Promise<void>,
    runtimeLeaseOwned = false
  ): Promise<void> {
    const normalizedPatch = this.messageStatusPendingService.mergePatches([
      data.patch,
    ]);
    const statusUpdate: IMessageStatusUpdate = {
      ...data,
      patch: normalizedPatch,
    };
    const assertPendingActive = async (): Promise<void> => {
      assertAssignmentActive();
      await assertClaimActive();
      assertAssignmentActive();
    };
    const assertStatusActive = this.statusMutationGuard(
      statusUpdate,
      assertPendingActive,
      runtimeLeaseOwned
    );
    const startTime = Date.now();

    try {
      await assertPendingActive();
      if (
        !(await this.isMutationRuntimeUsable(statusUpdate, runtimeLeaseOwned))
      ) {
        await this.runStatusRedisOperation('discard_stale_pending_claim', () =>
          this.messageStatusPendingService.discardClaimedPendingStatus(
            statusUpdate
          )
        );
        return;
      }
      await assertPendingActive();
      const alreadyApplied = await this.runStatusRedisOperation(
        'pending_is_applied',
        () => this.messageStatusPendingService.isApplied(statusUpdate)
      );
      await assertPendingActive();

      if (alreadyApplied) {
        await this.runStatusRedisOperation(
          'discard_applied_pending_claim',
          () =>
            this.messageStatusPendingService.discardClaimedPendingStatus(
              statusUpdate
            )
        );
        assertAssignmentActive();
        await this.markAsProcessed(statusUpdate);
        return;
      }

      await assertPendingActive();
      if (
        !(await this.isMutationRuntimeUsable(statusUpdate, runtimeLeaseOwned))
      ) {
        await this.runStatusRedisOperation('discard_stale_pending_claim', () =>
          this.messageStatusPendingService.discardClaimedPendingStatus(
            statusUpdate
          )
        );
        return;
      }
      await assertPendingActive();
      const updatedMessage = statusUpdate.failed
        ? await this.markMessageAsFailed(statusUpdate, assertStatusActive)
        : await this.updateMessageSummary(
            statusUpdate,
            normalizedPatch,
            assertStatusActive
          );

      const duration = Date.now() - startTime;
      await assertPendingActive();
      if (!updatedMessage?.message_id) {
        if (
          !(await this.isMutationRuntimeUsable(statusUpdate, runtimeLeaseOwned))
        ) {
          await this.runStatusRedisOperation(
            'discard_stale_pending_claim',
            () =>
              this.messageStatusPendingService.discardClaimedPendingStatus(
                statusUpdate
              )
          );
          return;
        }
        await assertPendingActive();
        await this.runStatusRedisOperation('reschedule_pending', () =>
          this.messageStatusPendingService.reschedulePendingStatus(
            statusUpdate,
            {
              batchSize: 1,
              duration,
            }
          )
        );
        return;
      }

      await assertPendingActive();
      await this.reconcileOfficialTemplateWindowStatus(
        statusUpdate,
        updatedMessage
      );
      await assertPendingActive();
      const markedApplied = await this.runStatusRedisOperation(
        'pending_mark_applied',
        () =>
          this.messageStatusPendingService.markApplied(
            statusUpdate,
            updatedMessage.message_id
          )
      );
      if (!markedApplied) {
        throw new Error('message_status_applied_ledger_rejected');
      }
      assertAssignmentActive();
      await this.markAsProcessed(statusUpdate);
    } catch (error) {
      if (isCriticalRedisOperationError(error)) {
        throw error;
      }
      if (this.isPendingClaimLeaseLost(error)) {
        // The processing lease expiry sweep makes this claim due again.
        return;
      }
      if (
        error instanceof KafkaConsumerDispatchRevokedError ||
        !this.isPendingAssignmentActive(statusUpdate) ||
        !(await this.isMutationRuntimeUsable(statusUpdate, runtimeLeaseOwned))
      ) {
        try {
          await this.requeuePendingAfterRuntimeAdmissionFailure(statusUpdate);
        } catch (requeueError) {
          if (!this.isPendingClaimLeaseLost(requeueError)) {
            throw requeueError;
          }
          // Ownership was lost while releasing. TTL recovery is authoritative.
        }
        return;
      }

      const duration = Date.now() - startTime;

      await this.runStatusRedisOperation('reschedule_pending_after_error', () =>
        this.messageStatusPendingService.reschedulePendingStatus(
          statusUpdate,
          {
            batchSize: 1,
            duration,
          },
          {
            incrementRetry: false,
          }
        )
      );
    }
  }

  private isPendingClaimLeaseLost(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; depth < 4; depth += 1) {
      if (
        current instanceof Error &&
        current.name === 'MessageStatusPendingClaimLeaseLostError'
      ) {
        return true;
      }
      if (!current || typeof current !== 'object' || !('cause' in current)) {
        return false;
      }
      const cause = (current as { cause?: unknown }).cause;
      if (cause === current) {
        return false;
      }
      current = cause;
    }
    return false;
  }

  private getIdempotencyKey(data: IMessageStatusUpdate): string {
    const scope = this.getMessageKey(
      data.account_id,
      data.message_id,
      data.worker_id
    );
    const eventId = data.event_id?.trim();
    if (eventId) {
      return `${this.idempotencyPrefix}${scope}:event:${eventId}`;
    }

    const patchHash = MessageStatusService.hashPatch(data.patch);
    return `${this.idempotencyPrefix}${scope}:${
      data.failed ? 'failed:' : ''
    }${patchHash}`;
  }

  private async isAlreadyProcessed(
    data: IMessageStatusUpdate
  ): Promise<boolean> {
    const key = this.getIdempotencyKey(data);
    const exists = await this.runStatusRedisOperation(
      'status_idempotency_exists',
      () => this.redis.exists(key)
    );
    return exists === 1;
  }

  private async markAsProcessed(data: IMessageStatusUpdate): Promise<void> {
    const key = this.getIdempotencyKey(data);
    await this.runStatusRedisOperation('status_idempotency_set', () =>
      this.redis.setex(key, this.idempotencyTtlSeconds, '1')
    );
  }

  private getMessageKey(
    accountId: string,
    messageId: string,
    workerId?: string
  ): string {
    const canonicalMessageId =
      canonicalMessageStatusMessageId(messageId) ?? messageId;
    return workerId?.trim()
      ? `${accountId}:${workerId.trim()}:${canonicalMessageId}`
      : `${accountId}:${canonicalMessageId}`;
  }

  private async processStatusUpdate(
    data: IMessageStatusUpdate,
    assertActive: () => void = () => undefined,
    runtimeLeaseOwned = false
  ): Promise<void> {
    const mergedPatch = this.messageStatusPendingService.mergePatches([
      data.patch,
    ]);
    const statusUpdate: IMessageStatusUpdate = {
      ...data,
      patch: mergedPatch,
    };
    const assertStatusActive = this.statusMutationGuard(
      statusUpdate,
      assertActive,
      runtimeLeaseOwned
    );
    const startTime = Date.now();

    try {
      assertActive();
      const alreadyApplied = await this.runStatusRedisOperation(
        'status_is_applied',
        () => this.messageStatusPendingService.isApplied(statusUpdate)
      );
      assertActive();

      if (alreadyApplied) {
        assertActive();
        await this.runStatusRedisOperation('clear_covered_pending_status', () =>
          this.messageStatusPendingService.clearPendingStatusIfCovered(
            statusUpdate
          )
        );
        assertActive();
        await this.markAsProcessed(statusUpdate);
        return;
      }

      const isAlreadyProcessed = await this.isAlreadyProcessed(statusUpdate);
      assertActive();

      if (isAlreadyProcessed) {
        assertActive();
        await this.runStatusRedisOperation(
          'clear_processed_pending_status',
          () =>
            this.messageStatusPendingService.clearPendingStatusIfCovered(
              statusUpdate
            )
        );
        return;
      }

      assertActive();
      const updatedMessage = statusUpdate.failed
        ? await this.markMessageAsFailed(statusUpdate, assertStatusActive)
        : await this.updateMessageSummary(
            statusUpdate,
            mergedPatch,
            assertStatusActive
          );

      assertActive();
      if (!updatedMessage) {
        if (
          !(await this.isMutationRuntimeUsable(statusUpdate, runtimeLeaseOwned))
        ) {
          await this.runStatusRedisOperation(
            'discard_stale_pending_event',
            () =>
              this.messageStatusPendingService.discardPendingStatusForEvent(
                statusUpdate
              )
          );
          return;
        }
        assertActive();
        const duration = Date.now() - startTime;

        await this.runStatusRedisOperation('defer_missing_status', () =>
          this.messageStatusPendingService.deferMissingStatusUpdate(
            statusUpdate,
            mergedPatch,
            {
              batchSize: 1,
              duration,
            }
          )
        );
        return;
      }

      assertActive();
      await this.reconcileOfficialTemplateWindowStatus(
        statusUpdate,
        updatedMessage
      );
      assertActive();
      const markedApplied = await this.runStatusRedisOperation(
        'status_mark_applied',
        () =>
          this.messageStatusPendingService.markApplied(
            statusUpdate,
            updatedMessage.message_id
          )
      );
      if (!markedApplied) {
        throw new Error('message_status_applied_ledger_rejected');
      }

      assertActive();
      await this.markAsProcessed(statusUpdate);
    } catch (error) {
      if (error instanceof KafkaConsumerDispatchRevokedError) {
        throw error;
      }
      if (isCriticalRedisOperationError(error)) {
        throw error;
      }
      if (
        !(await this.isMutationRuntimeUsable(statusUpdate, runtimeLeaseOwned))
      ) {
        await this.runStatusRedisOperation('discard_stale_pending_event', () =>
          this.messageStatusPendingService.discardPendingStatusForEvent(
            statusUpdate
          )
        );
        return;
      }
      assertActive();
      const duration = Date.now() - startTime;

      await this.runStatusRedisOperation('reschedule_status_after_error', () =>
        this.messageStatusPendingService.reschedulePendingStatus(
          statusUpdate,
          {
            batchSize: 1,
            duration,
          },
          {
            incrementRetry: false,
          }
        )
      );
    }
  }

  private statusMutationGuard(
    data: IMessageStatusUpdate,
    assertActive: () => void | Promise<void>,
    runtimeLeaseOwned = false
  ): () => Promise<void> {
    return async () => {
      await assertActive();
      if (!(await this.isMutationRuntimeUsable(data, runtimeLeaseOwned))) {
        throw new Error('whatsapp_runtime_fence_revoked');
      }
      await assertActive();
    };
  }

  private isMutationRuntimeUsable(
    data: IMessageStatusUpdate,
    runtimeLeaseOwned: boolean
  ): Promise<boolean> {
    return runtimeLeaseOwned
      ? Promise.resolve(true)
      : this.isRuntimeCurrent(data);
  }

  private async reconcileOfficialTemplateWindowStatus(
    statusUpdate: IMessageStatusUpdate,
    canonicalMessage: IChatMessage
  ): Promise<void> {
    if (canonicalMessage.content?.type !== EMessageType.official_template) {
      return;
    }

    const deliveryStatus = canonicalMessage.delivery_status?.trim();
    const isCanonicalDeliveredOrRead =
      deliveryStatus === 'delivered' ||
      deliveryStatus === 'read' ||
      canonicalMessage.summary?.is_delivered === true ||
      canonicalMessage.summary?.is_seen === true;
    const isTerminalReceipt =
      statusUpdate.failed === true ||
      statusUpdate.ambiguous === true ||
      deliveryStatus === 'ambiguous';
    if (isTerminalReceipt && isCanonicalDeliveredOrRead) {
      return;
    }

    if (statusUpdate.ambiguous === true || deliveryStatus === 'ambiguous') {
      await this.officialWindowService.recordTemplateUncertainForMessage(
        canonicalMessage,
        statusUpdate.message_id
      );
      return;
    }

    if (statusUpdate.failed === true && deliveryStatus === 'failed') {
      await this.officialWindowService.recordTemplateFailureForMessage(
        canonicalMessage,
        statusUpdate.provider_error_code,
        statusUpdate.message_id
      );
      return;
    }

    const isCanonicalPositiveOutcome =
      deliveryStatus === 'sent' ||
      isCanonicalDeliveredOrRead ||
      canonicalMessage.summary?.is_sent === true;
    if (statusUpdate.failed !== true && isCanonicalPositiveOutcome) {
      await this.officialWindowService.recordProviderAcceptedMessage(
        canonicalMessage,
        statusUpdate.message_id
      );
    }
  }

  private markMessageAsFailed(
    data: IMessageStatusUpdate,
    assertActive: () => Promise<void>
  ) {
    const providerStatus = this.providerStatusMetadata(data);
    const internalMessageId = data.internal_message_id?.trim();
    if (internalMessageId) {
      if (!providerStatus) {
        return this.messageStatusService.markMessageAsNotSent(
          data.account_id,
          internalMessageId,
          assertActive,
          data.ambiguous === true ? 'ambiguous' : 'failed'
        );
      }
      return this.messageStatusService.markMessageAsNotSent(
        data.account_id,
        internalMessageId,
        assertActive,
        data.ambiguous === true ? 'ambiguous' : 'failed',
        providerStatus
      );
    }

    if (!providerStatus) {
      return this.messageStatusService.markMessageAsNotSentByWhatsAppId(
        data.account_id,
        data.message_id,
        data.key,
        data.worker_id,
        assertActive,
        data.ambiguous === true ? 'ambiguous' : 'failed'
      );
    }

    return this.messageStatusService.markMessageAsNotSentByWhatsAppId(
      data.account_id,
      data.message_id,
      data.key,
      data.worker_id,
      assertActive,
      data.ambiguous === true ? 'ambiguous' : 'failed',
      providerStatus
    );
  }

  private updateMessageSummary(
    data: IMessageStatusUpdate,
    patch: IMessageStatusUpdate['patch'],
    assertActive: () => Promise<void>
  ) {
    const providerStatus = this.providerStatusMetadata(data);
    if (!providerStatus) {
      return this.messageStatusService.updateSummaryByWhatsAppId(
        data.account_id,
        data.message_id,
        patch,
        data.key,
        data.worker_id,
        assertActive
      );
    }

    return this.messageStatusService.updateSummaryByWhatsAppId(
      data.account_id,
      data.message_id,
      patch,
      data.key,
      data.worker_id,
      assertActive,
      providerStatus
    );
  }

  private providerStatusMetadata(data: IMessageStatusUpdate) {
    if (data.provider_error_code === undefined && !data.provider_status_at) {
      return undefined;
    }

    return {
      errorCode: data.provider_error_code ?? null,
      occurredAt: data.provider_status_at ?? null,
    };
  }

  private runStatusRedisOperation<T>(
    operation: string,
    action: () => Promise<T>
  ): Promise<T> {
    return runCriticalRedisOperation(`message_status_${operation}`, action);
  }
}
