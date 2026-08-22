import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IScheduleStatusUpdate } from '@core/common/interfaces/IScheduleStatusUpdate';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { scheduleMappings } from '@core/mappings/schedule.mappings';
import {
  ScheduleStatusUpdateScriptParams,
  ScheduleDocumentBaseline,
} from '@core/common/interfaces/IScheduleStatusUpdateScript';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import {
  buildScheduleStatusKafkaKey,
  buildScheduleStatusEventId,
  ensureScheduleStatusEventId,
} from '@core/common/functions/scheduleStatusIdentity';
import { WhatsappRuntimeFenceService } from '@core/services/whatsappRuntimeFence.service';
import {
  ScheduleLegacyProcessingBootstrapLease,
  ScheduleLegacyProcessingBootstrapLeaseLostError,
  ScheduleReconciliationLease,
  ScheduleReconciliationLeaseLostError,
  ScheduleStatusCoordinationService,
} from '@core/services/scheduleStatusCoordination.service';
import { SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS } from '@core/common/functions/serviceApiWhatsappConsumerBindings';
import {
  acquireReboundAuxiliaryRuntimeLease,
  AuxiliaryRuntimeLeaseRaceError,
  isUnrecoverableAuxiliaryRuntimeEventError,
} from '@core/consumer/auxiliaryRuntimeRebind';
import type { KafkaConsumerEffectLease } from '@core/common/interfaces/KafkaConsumerRunnerOptions';

interface IStaleScheduleMessage {
  account_id: string;
  worker_id: string;
  contact_id: string;
  message_id: string;
  attempt_id?: string;
}

interface IStatusUpdateOptions {
  expectedCurrentStatus?: EScheduleStatus.processing;
  allowUpsert?: boolean;
  skipRuntimeFence?: boolean;
}

interface ILegacyProcessingScheduleBucket {
  key?: {
    schedule_id?: string;
  };
  oldest_updated_at?: {
    value?: number | null;
  };
  without_updated_at?: {
    oldest_created_at?: {
      value?: number | null;
    };
    without_timestamp?: {
      doc_count?: number;
    };
  };
}

interface ILegacyProcessingScheduleAggregations {
  processing_schedules?: {
    buckets?: ILegacyProcessingScheduleBucket[];
    after_key?: Record<string, string>;
  };
}

class ScheduleReconciliationStoppedError extends Error {
  constructor() {
    super('Schedule reconciliation worker stopped');
    this.name = 'ScheduleReconciliationStoppedError';
  }
}

@singleton()
export class ScheduleStatusUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IScheduleStatusUpdate> | null = null;
  private isRunning = false;
  private isReconciliationPollRunning = false;
  private readonly TIMEOUT_MS = 5 * 60 * 1000;
  private readonly reconciliationPollIntervalMs = 1_000;
  private readonly reconciliationBatchSize = 25;
  private readonly legacyProcessingBootstrapPageSize = 1_000;
  private readonly staleProcessingPageSize = 1_000;
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
  private reconciliationAbortController: AbortController | null = null;
  private reconciliationPollPromise: Promise<void> | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(WhatsappRuntimeFenceService)
    private readonly runtimeFence: WhatsappRuntimeFenceService,
    @inject(ScheduleStatusCoordinationService)
    private readonly coordination: ScheduleStatusCoordinationService
  ) {}

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.scheduleStatusUpdate();
    this.runner = new KafkaConsumerRunner<IScheduleStatusUpdate>({
      kafka: this.kafka,
      topic,
      groupId: SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS.scheduleStatusUpdate,
      startPosition: 'committed',
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => buildScheduleStatusKafkaKey(data),
      preserveEntityOrder: true,
      acquireEffectLease: (data) => this.acquireRuntimeEffectLease(data),
      classifyEffectLeaseRejection: async (data) =>
        (await this.runtimeFence.isCurrent(data)) ? 'retry' : 'terminal',
      handle: async (data, context) => {
        context.assertActive();
        try {
          await this.handleStatusUpdate(
            data,
            context.message,
            context.assertActive,
            true
          );
        } catch (error) {
          context.assertActive();
          console.error(
            `Error processing schedule status update for schedule ${data.schedule_id}, contact ${data.contact_id}:`,
            error
          );
          throw error;
        }
      },
      classifyError: (_data, _context, error) =>
        isUnrecoverableAuxiliaryRuntimeEventError(error)
          ? 'terminal'
          : 'retryable',
      shouldContinueRetryWithoutCommit: (_data, _context, error) =>
        error instanceof AuxiliaryRuntimeLeaseRaceError ||
        !isUnrecoverableAuxiliaryRuntimeEventError(error),
      logger: console,
    });

    this.startReconciliationWorker();
    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
  }

  public async close(): Promise<void> {
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
    this.reconciliationAbortController?.abort();
    await this.reconciliationPollPromise?.catch(() => undefined);
    this.reconciliationPollPromise = null;
    this.reconciliationAbortController = null;

    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }

  private parseMessage(value: Buffer | null): IScheduleStatusUpdate | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IScheduleStatusUpdate;
      if (
        parsed &&
        'schedule_id' in parsed &&
        'contact_id' in parsed &&
        'message_id' in parsed &&
        'status' in parsed
      ) {
        ensureScheduleStatusEventId(parsed);
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async handleStatusUpdate(
    data: IScheduleStatusUpdate,
    message: { partition: number; offset: number; timestamp?: number },
    assertActive: () => void | Promise<void> = () => undefined,
    runtimeLeaseOwned = false
  ): Promise<void> {
    await assertActive();
    if (!runtimeLeaseOwned && !(await this.runtimeFence.isCurrent(data))) {
      console.info('[ScheduleStatusUpdate] Discarding stale runtime event', {
        schedule_id: data.schedule_id,
        contact_id: data.contact_id,
        message_id: data.message_id,
        worker_id: data.worker_id,
        source_provider: data.source_provider,
        runtime_generation: data.runtime_generation,
        connection_epoch: data.connection_epoch,
      });
      return;
    }

    await assertActive();
    const operationalTransition =
      await this.recordIncomingOperationalOutcome(data);
    await assertActive();
    if (
      operationalTransition === 'stale' ||
      operationalTransition === 'invalid'
    ) {
      console.warn(
        '[ScheduleStatusUpdate] Discarding status that conflicts with the durable operational outcome',
        {
          account_id: data.account_id,
          worker_id: data.worker_id,
          schedule_id: data.schedule_id,
          contact_id: data.contact_id,
          message_id: data.message_id,
          attempt_id: data.attempt_id,
          status: data.status,
          operational_transition: operationalTransition,
        }
      );
      return;
    }

    const statusApplied = await this.updateMessageStatusInElasticsearch(
      data,
      message,
      assertActive,
      runtimeLeaseOwned ? { skipRuntimeFence: true } : {}
    );
    await assertActive();
    if (!statusApplied) {
      return;
    }

    await this.coordination.scheduleReconciliation(
      data.schedule_id,
      this.TIMEOUT_MS
    );
    await assertActive();
  }

  private isImmutableIdentityValid(data: IScheduleStatusUpdate): boolean {
    return (
      Boolean(data.account_id?.trim()) &&
      Boolean(data.worker_id?.trim()) &&
      Boolean(data.source_provider?.trim()) &&
      Boolean(data.attempt_id?.trim()) &&
      Boolean(data.schedule_id?.trim()) &&
      Boolean(data.contact_id?.trim()) &&
      Boolean(data.message_id?.trim()) &&
      data.event_id?.trim() === buildScheduleStatusEventId(data)
    );
  }

  private acquireRuntimeEffectLease(
    data: IScheduleStatusUpdate
  ): Promise<KafkaConsumerEffectLease | null> {
    return acquireReboundAuxiliaryRuntimeLease(
      data,
      this.runtimeFence,
      (candidate) => this.isImmutableIdentityValid(candidate)
    );
  }

  private async recordIncomingOperationalOutcome(
    data: IScheduleStatusUpdate
  ): Promise<'transitioned' | 'unchanged' | 'stale' | 'invalid' | null> {
    if (
      data.status !== EScheduleStatus.sent &&
      data.status !== EScheduleStatus.failed
    ) {
      return null;
    }

    const accountId = data.account_id?.trim();
    const workerId = data.worker_id?.trim();
    const attemptId = data.attempt_id?.trim();
    if (!accountId || !workerId || !attemptId) {
      return null;
    }

    const identity = {
      scheduleId: data.schedule_id,
      accountId,
      workerId,
      messageId: data.message_id,
      attemptId,
    };
    const transition = await this.coordination.setMessageOperationalState(
      identity,
      data.status === EScheduleStatus.sent ? 'succeeded' : 'pre_provider_failed'
    );

    if (
      data.status === EScheduleStatus.failed &&
      transition === 'invalid' &&
      (await this.coordination.getMessageOperationalState(identity)) ===
        'provider_rejected'
    ) {
      return 'unchanged';
    }

    return transition;
  }

  private startReconciliationWorker(): void {
    if (this.reconciliationTimer) {
      return;
    }

    this.reconciliationAbortController = new AbortController();
    const signal = this.reconciliationAbortController.signal;
    const poll = (): void => {
      if (this.reconciliationPollPromise || signal.aborted) {
        return;
      }
      const run = this.processDueReconciliations(signal);
      this.reconciliationPollPromise = run;
      void run
        .catch((error) => {
          if (!(error instanceof ScheduleReconciliationStoppedError)) {
            console.error(
              '[ScheduleStatusUpdate] Failed to poll schedule reconciliations:',
              error
            );
          }
        })
        .finally(() => {
          if (this.reconciliationPollPromise === run) {
            this.reconciliationPollPromise = null;
          }
        });
    };

    poll();
    this.reconciliationTimer = setInterval(
      poll,
      this.reconciliationPollIntervalMs
    );
    this.reconciliationTimer.unref?.();
  }

  private async processDueReconciliations(
    signal: AbortSignal = new AbortController().signal
  ): Promise<void> {
    if (this.isReconciliationPollRunning) {
      return;
    }

    this.isReconciliationPollRunning = true;
    try {
      this.assertReconciliationWorkerActive(signal);
      await this.bootstrapLegacyProcessingSchedules(signal);
      this.assertReconciliationWorkerActive(signal);
      const leases = await this.coordination.claimDueReconciliations(
        this.reconciliationBatchSize
      );
      for (const lease of leases) {
        this.assertReconciliationWorkerActive(signal);
        await this.processReconciliationLease(lease, signal);
      }
    } finally {
      this.isReconciliationPollRunning = false;
    }
  }

  private async bootstrapLegacyProcessingSchedules(
    signal: AbortSignal
  ): Promise<void> {
    this.assertReconciliationWorkerActive(signal);
    const claim = await this.coordination.claimLegacyProcessingBootstrap();
    if (claim.state !== 'acquired') {
      return;
    }

    const { lease } = claim;
    let completed = false;
    try {
      const deadlines = await this.getLegacyProcessingScheduleDeadlines(
        lease,
        signal
      );
      let seededSchedules = 0;

      for (const [scheduleId, deadline] of deadlines) {
        this.assertReconciliationWorkerActive(signal);
        await this.coordination.assertLegacyProcessingBootstrapLease(lease);
        const result = await this.coordination.seedLegacyReconciliationDeadline(
          scheduleId,
          deadline
        );
        if (result.seeded) {
          seededSchedules++;
        }
      }

      await this.coordination.assertLegacyProcessingBootstrapLease(lease);
      this.assertReconciliationWorkerActive(signal);
      completed = await this.coordination.completeLegacyProcessingBootstrap(
        lease,
        seededSchedules
      );
      if (!completed) {
        throw new ScheduleLegacyProcessingBootstrapLeaseLostError();
      }

      console.info('[ScheduleStatusUpdate] Legacy processing scan completed', {
        processing_schedules: deadlines.size,
        seeded_schedules: seededSchedules,
      });
    } finally {
      if (!completed) {
        await this.coordination
          .releaseLegacyProcessingBootstrapLease(lease)
          .catch(() => undefined);
      }
    }
  }

  private async getLegacyProcessingScheduleDeadlines(
    lease: ScheduleLegacyProcessingBootstrapLease,
    signal: AbortSignal
  ): Promise<Map<string, number>> {
    this.assertReconciliationWorkerActive(signal);
    await this.coordination.assertLegacyProcessingBootstrapLease(lease);
    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );

    const deadlines = new Map<string, number>();
    let afterKey: Record<string, string> | undefined;

    do {
      this.assertReconciliationWorkerActive(signal);
      await this.coordination.assertLegacyProcessingBootstrapLease(lease);
      this.assertReconciliationWorkerActive(signal);
      const result = await this.elasticDatabaseService.select<never>(
        EElasticIndex.schedule,
        {
          size: 0,
          query: {
            term: {
              status: EScheduleStatus.processing,
            },
          },
          aggs: {
            processing_schedules: {
              composite: {
                size: this.legacyProcessingBootstrapPageSize,
                sources: [
                  {
                    schedule_id: {
                      terms: {
                        field: 'schedule_id',
                      },
                    },
                  },
                ],
                ...(afterKey ? { after: afterKey } : {}),
              },
              aggs: {
                oldest_updated_at: {
                  min: {
                    field: 'updated_at_epoch_millis',
                  },
                },
                without_updated_at: {
                  filter: {
                    bool: {
                      must_not: [
                        {
                          exists: {
                            field: 'updated_at_epoch_millis',
                          },
                        },
                      ],
                    },
                  },
                  aggs: {
                    oldest_created_at: {
                      min: {
                        field: 'created_at',
                      },
                    },
                    without_timestamp: {
                      filter: {
                        bool: {
                          must_not: [
                            {
                              exists: {
                                field: 'created_at',
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }
      );
      await this.coordination.assertLegacyProcessingBootstrapLease(lease);

      if (!result) {
        throw new Error('schedule_legacy_processing_bootstrap_search_failed');
      }

      const aggregations =
        result.aggregations as unknown as ILegacyProcessingScheduleAggregations;
      const page = aggregations?.processing_schedules;
      const buckets = page?.buckets ?? [];

      for (const bucket of buckets) {
        const scheduleId = bucket.key?.schedule_id?.trim();
        if (!scheduleId) {
          continue;
        }

        const missingTimestampCount =
          bucket.without_updated_at?.without_timestamp?.doc_count ?? 0;
        const candidates = [
          bucket.oldest_updated_at?.value,
          bucket.without_updated_at?.oldest_created_at?.value,
        ].filter(
          (value): value is number =>
            typeof value === 'number' && Number.isFinite(value)
        );
        const oldestTimestamp =
          missingTimestampCount > 0 || candidates.length === 0
            ? 0
            : Math.min(...candidates);
        const deadline = oldestTimestamp + this.TIMEOUT_MS;
        const currentDeadline = deadlines.get(scheduleId);
        deadlines.set(
          scheduleId,
          currentDeadline === undefined
            ? deadline
            : Math.min(currentDeadline, deadline)
        );
      }

      afterKey = page?.after_key;
    } while (afterKey);

    return deadlines;
  }

  private async processReconciliationLease(
    lease: ScheduleReconciliationLease,
    signal: AbortSignal
  ): Promise<void> {
    let completed = false;
    try {
      completed = await this.reconcileSchedule(lease, signal);
    } catch (error) {
      if (error instanceof ScheduleReconciliationStoppedError) {
        return;
      }
      if (error instanceof ScheduleReconciliationLeaseLostError) {
        console.info('[ScheduleStatusUpdate] Reconciliation lease was lost', {
          schedule_id: lease.scheduleId,
        });
      } else {
        console.error(
          `[ScheduleStatusUpdate] Failed to reconcile schedule ${lease.scheduleId}:`,
          error
        );
      }
    } finally {
      if (!completed) {
        await this.coordination
          .releaseReconciliationLease(lease)
          .catch(() => undefined);
      }
    }
  }

  private async reconcileSchedule(
    lease: ScheduleReconciliationLease,
    signal: AbortSignal = new AbortController().signal
  ): Promise<boolean> {
    const assertLeaseActive = async (): Promise<void> => {
      this.assertReconciliationWorkerActive(signal);
      await this.coordination.assertReconciliationLease(lease);
      this.assertReconciliationWorkerActive(signal);
    };
    const redisNow = await this.coordination.currentTimeMilliseconds();
    const cutoffEpochMillis = redisNow - this.TIMEOUT_MS;

    await assertLeaseActive();
    let searchAfter: unknown[] | undefined;
    do {
      const page = await this.getStaleProcessingMessagePage(
        lease.scheduleId,
        cutoffEpochMillis,
        searchAfter
      );
      await assertLeaseActive();

      for (const message of page.messages) {
        await this.reconcileStaleProcessingMessage(
          lease,
          message,
          redisNow,
          assertLeaseActive
        );
      }

      searchAfter = page.nextSearchAfter;
    } while (searchAfter);

    await assertLeaseActive();
    const remainingProcessing = await this.countProcessingMessages(
      lease.scheduleId
    );
    await assertLeaseActive();

    if (remainingProcessing > 0) {
      await this.coordination.scheduleReconciliation(
        lease.scheduleId,
        this.TIMEOUT_MS
      );
      await assertLeaseActive();
      return false;
    }

    const completed =
      await this.coordination.completeReconciliationLease(lease);
    if (!completed) {
      throw new ScheduleReconciliationLeaseLostError(lease.scheduleId);
    }
    return true;
  }

  private async reconcileStaleProcessingMessage(
    scheduleLease: ScheduleReconciliationLease,
    message: IStaleScheduleMessage,
    redisNow: number,
    assertScheduleLeaseActive: () => Promise<void>
  ): Promise<void> {
    await assertScheduleLeaseActive();
    const claim = await this.coordination.claimMessageAttemptForReconciliation({
      scheduleId: scheduleLease.scheduleId,
      messageId: message.message_id,
      attemptId: message.attempt_id,
    });
    if (claim.state !== 'acquired') {
      return;
    }

    let attemptCompleted = false;
    const assertMessageAndScheduleActive = async (): Promise<void> => {
      await assertScheduleLeaseActive();
      await this.coordination.assertMessageAttemptLease(claim.lease);
      await assertScheduleLeaseActive();
    };

    try {
      await assertMessageAndScheduleActive();
      const attemptId = message.attempt_id?.trim();
      if (!attemptId) {
        console.warn(
          '[ScheduleStatusUpdate] Leaving legacy processing message untouched because it has no attempt identity',
          {
            account_id: message.account_id,
            worker_id: message.worker_id,
            schedule_id: scheduleLease.scheduleId,
            contact_id: message.contact_id,
            message_id: message.message_id,
          }
        );
        return;
      }

      const operationalState =
        await this.coordination.getMessageOperationalState({
          scheduleId: scheduleLease.scheduleId,
          accountId: message.account_id,
          workerId: message.worker_id,
          messageId: message.message_id,
          attemptId,
        });
      await assertMessageAndScheduleActive();

      if (operationalState === null || operationalState === 'pending') {
        return;
      }

      if (operationalState === 'ambiguous') {
        await this.markAmbiguousOperationalOutcome(
          message,
          attemptId,
          assertMessageAndScheduleActive
        );
        await assertMessageAndScheduleActive();
        console.warn(
          '[ScheduleStatusUpdate] Provider invocation is ambiguous; suppressing automatic failure and retry',
          {
            account_id: message.account_id,
            worker_id: message.worker_id,
            schedule_id: scheduleLease.scheduleId,
            contact_id: message.contact_id,
            message_id: message.message_id,
            attempt_id: attemptId,
          }
        );
        attemptCompleted = await this.coordination.completeMessageAttemptLease(
          claim.lease,
          'ambiguous'
        );
        if (!attemptCompleted) {
          throw new ScheduleReconciliationLeaseLostError(
            scheduleLease.scheduleId
          );
        }
        return;
      }

      const reconciledStatus =
        operationalState === 'succeeded'
          ? EScheduleStatus.sent
          : EScheduleStatus.failed;
      const statusApplied = await this.updateMessageStatusInElasticsearch(
        {
          account_id: message.account_id,
          worker_id: message.worker_id,
          schedule_id: scheduleLease.scheduleId,
          contact_id: message.contact_id,
          message_id: message.message_id,
          attempt_id: attemptId,
          processed_at: new Date(redisNow).toISOString(),
          status: reconciledStatus,
        },
        {
          partition: 0,
          offset: 0,
          timestamp: redisNow,
        },
        assertMessageAndScheduleActive,
        {
          expectedCurrentStatus: EScheduleStatus.processing,
          allowUpsert: false,
          skipRuntimeFence: true,
        }
      );
      await assertMessageAndScheduleActive();
      if (!statusApplied) {
        return;
      }

      attemptCompleted = await this.coordination.completeMessageAttemptLease(
        claim.lease,
        operationalState
      );
      if (!attemptCompleted) {
        throw new ScheduleReconciliationLeaseLostError(
          scheduleLease.scheduleId
        );
      }
    } finally {
      if (!attemptCompleted) {
        await this.coordination
          .releaseMessageAttemptLease(claim.lease)
          .catch(() => undefined);
      }
    }
  }

  private async markAmbiguousOperationalOutcome(
    message: IStaleScheduleMessage,
    attemptId: string,
    assertActive: () => void | Promise<void>
  ): Promise<void> {
    await assertActive();
    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );
    await assertActive();

    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.schedule,
      message.message_id,
      {
        source: `
          if (ctx._source == null) {
            ctx.op = 'noop';
            return;
          }
          if (
            ctx._source.status == null ||
            !ctx._source.status.equals(params.expected_status)
          ) {
            ctx.op = 'noop';
            return;
          }
          if (
            ctx._source.attempt_id == null ||
            !ctx._source.attempt_id.equals(params.attempt_id)
          ) {
            ctx.op = 'noop';
            return;
          }
          if (
            ctx._source.operational_state != null &&
            ctx._source.operational_state.equals(params.operational_state)
          ) {
            ctx.op = 'noop';
            return;
          }
          ctx._source.operational_state = params.operational_state;
        `,
        params: {
          expected_status: EScheduleStatus.processing,
          attempt_id: attemptId,
          operational_state: 'ambiguous',
        },
      },
      {
        upsert: false,
        maxRetries: 5,
        assertActive,
      }
    );
    await assertActive();
    if (result === 'conflict') {
      throw new Error(
        `schedule_ambiguous_operational_state_conflict:${message.message_id}`
      );
    }
  }

  private async getStaleProcessingMessagePage(
    scheduleId: string,
    cutoffEpochMillis: number,
    searchAfter?: unknown[]
  ): Promise<{
    messages: IStaleScheduleMessage[];
    nextSearchAfter?: unknown[];
  }> {
    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );

    const result = await this.elasticDatabaseService.select<{
      id: string;
      attempt_id?: string;
      account?: { id?: string };
      worker?: { id?: string };
      contact: { id: string };
    }>(EElasticIndex.schedule, {
      size: this.staleProcessingPageSize,
      _source: ['id', 'attempt_id', 'account.id', 'worker.id', 'contact.id'],
      sort: [
        {
          id: {
            order: 'asc',
            missing: '_last',
          },
        },
      ],
      ...(searchAfter ? { search_after: searchAfter } : {}),
      query: {
        bool: {
          filter: [
            {
              term: {
                schedule_id: scheduleId,
              },
            },
            {
              term: {
                status: EScheduleStatus.processing,
              },
            },
            {
              bool: {
                should: [
                  {
                    range: {
                      updated_at_epoch_millis: {
                        lte: cutoffEpochMillis,
                      },
                    },
                  },
                  {
                    bool: {
                      must_not: [
                        {
                          exists: {
                            field: 'updated_at_epoch_millis',
                          },
                        },
                      ],
                      filter: [
                        {
                          range: {
                            created_at: {
                              lte: new Date(cutoffEpochMillis).toISOString(),
                            },
                          },
                        },
                      ],
                    },
                  },
                ],
                minimum_should_match: 1,
              },
            },
          ],
        },
      },
    });

    if (!result) {
      throw new Error(`schedule_reconciliation_search_failed:${scheduleId}`);
    }

    const hits = result.hits.hits;
    const messages = hits.flatMap((hit) => {
      const source = hit._source;
      const accountId = source?.account?.id?.trim();
      const workerId = source?.worker?.id?.trim();
      const contactId = source?.contact?.id?.trim();
      const messageId = source?.id?.trim() || hit._id?.trim();
      if (!accountId || !workerId || !contactId || !messageId) {
        console.warn(
          '[ScheduleStatusUpdate] Skipping stale processing document without complete operational correlation',
          {
            schedule_id: scheduleId,
            document_id: hit._id,
            account_id: accountId,
            worker_id: workerId,
            contact_id: contactId,
            message_id: messageId,
          }
        );
        return [];
      }
      const attemptId = source?.attempt_id?.trim();
      return [
        {
          account_id: accountId,
          worker_id: workerId,
          contact_id: contactId,
          message_id: messageId,
          ...(attemptId ? { attempt_id: attemptId } : {}),
        },
      ];
    });
    const lastSort = hits.at(-1)?.sort;
    if (
      hits.length >= this.staleProcessingPageSize &&
      !Array.isArray(lastSort)
    ) {
      throw new Error(
        `schedule_reconciliation_search_after_missing:${scheduleId}`
      );
    }

    return {
      messages,
      ...(hits.length >= this.staleProcessingPageSize && Array.isArray(lastSort)
        ? { nextSearchAfter: lastSort }
        : {}),
    };
  }

  private async countProcessingMessages(scheduleId: string): Promise<number> {
    const result = await this.elasticDatabaseService.select<never>(
      EElasticIndex.schedule,
      {
        size: 0,
        track_total_hits: true,
        query: {
          bool: {
            filter: [
              {
                term: {
                  schedule_id: scheduleId,
                },
              },
              {
                term: {
                  status: EScheduleStatus.processing,
                },
              },
            ],
            must_not: [
              {
                term: {
                  operational_state: 'ambiguous',
                },
              },
            ],
          },
        },
      }
    );

    if (!result) {
      throw new Error(`schedule_reconciliation_count_failed:${scheduleId}`);
    }

    const total = result.hits.total;
    return typeof total === 'number' ? total : (total?.value ?? 0);
  }

  private async extractEventTimestamp(
    message: { timestamp?: number },
    data: IScheduleStatusUpdate & { created_at?: string; date?: string }
  ): Promise<number> {
    if (message.timestamp) {
      return message.timestamp;
    }

    if (data.processed_at) {
      return new Date(data.processed_at).getTime();
    }

    if (data.created_at) {
      return new Date(data.created_at).getTime();
    }

    if (data.date) {
      return new Date(data.date).getTime();
    }

    return this.coordination.currentTimeMilliseconds();
  }

  private buildLastEventSortKey(
    eventTimeEpochMillis: number,
    partition: number,
    offset: number
  ): string {
    const partitionPadded = partition.toString().padStart(10, '0');
    const offsetPadded = offset.toString().padStart(20, '0');
    return `${eventTimeEpochMillis}:${partitionPadded}:${offsetPadded}`;
  }

  private scheduleStatusRank(status: IScheduleStatusUpdate['status']): number {
    switch (status) {
      case EScheduleStatus.sent:
        return 3;
      case EScheduleStatus.ignored:
        return 2;
      case EScheduleStatus.failed:
      default:
        return 1;
    }
  }

  private assertReconciliationWorkerActive(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new ScheduleReconciliationStoppedError();
    }
  }

  private async updateMessageStatusInElasticsearch(
    data: IScheduleStatusUpdate & { created_at?: string; date?: string },
    message: { partition: number; offset: number; timestamp?: number },
    assertActive: () => void | Promise<void> = () => undefined,
    options: IStatusUpdateOptions = {}
  ): Promise<boolean> {
    await assertActive();
    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );
    await assertActive();

    const eventTimeEpochMillis = await this.extractEventTimestamp(
      message,
      data
    );
    const eventTimeIso = new Date(eventTimeEpochMillis).toISOString();
    const lastEventSortKey = this.buildLastEventSortKey(
      eventTimeEpochMillis,
      message.partition,
      message.offset
    );
    const eventId = ensureScheduleStatusEventId(data);
    const statusRank = this.scheduleStatusRank(data.status);
    const attemptId = data.attempt_id?.trim();

    const params: ScheduleStatusUpdateScriptParams = {
      status: data.status,
      status_rank: statusRank,
      event_time_iso: eventTimeIso,
      event_time_epoch_millis: eventTimeEpochMillis,
      last_event_sort_key: lastEventSortKey,
      last_event_id: eventId,
      ...(attemptId ? { attempt_id: attemptId } : {}),
      ...(options.expectedCurrentStatus
        ? { expected_current_status: options.expectedCurrentStatus }
        : {}),
    };

    const baseline: ScheduleDocumentBaseline = {
      status: data.status,
      status_rank: statusRank,
      send_date: eventTimeIso,
      updated_at: eventTimeIso,
      updated_at_epoch_millis: eventTimeEpochMillis,
      last_event_sort_key: lastEventSortKey,
      last_event_id: eventId,
      ...(attemptId ? { attempt_id: attemptId } : {}),
    };

    const scriptSource = `
      if (ctx._source == null) {
        ctx._source = [:];
      }

      if (
        params.attempt_id != null &&
        ctx._source.attempt_id != null &&
        !ctx._source.attempt_id.equals(params.attempt_id)
      ) {
        ctx.op = 'noop';
        return;
      }
      if (params.attempt_id == null && ctx._source.attempt_id != null) {
        ctx.op = 'noop';
        return;
      }

      if (
        params.expected_current_status != null &&
        (
          ctx._source.status == null ||
          !ctx._source.status.equals(params.expected_current_status)
        )
      ) {
        ctx.op = 'noop';
        return;
      }

      def currentSort = ctx._source.last_event_sort_key != null
        ? ctx._source.last_event_sort_key
        : '';

      def eventSort = params.last_event_sort_key;
      if (params.expected_current_status == null) {
        if (
          ctx._source.last_event_id != null &&
          ctx._source.last_event_id.equals(params.last_event_id) &&
          ctx._source.status != null &&
          ctx._source.status.equals(params.status)
        ) {
          ctx.op = 'noop';
          return;
        }

        def currentRank = ctx._source.status_rank;
        if (currentRank == null) {
          if (ctx._source.status == 'sent') {
            currentRank = 3;
          } else if (ctx._source.status == 'ignored') {
            currentRank = 2;
          } else {
            currentRank = 1;
          }
        }

        if (params.status_rank < currentRank) {
          ctx.op = 'noop';
          return;
        }

        if (
          params.status_rank == currentRank &&
          eventSort.compareTo(currentSort) <= 0
        ) {
          ctx.op = 'noop';
          return;
        }
      }

      ctx._source.status = params.status;
      ctx._source.status_rank = params.status_rank;
      ctx._source.send_date = params.event_time_iso;
      ctx._source.updated_at = params.event_time_iso;
      ctx._source.updated_at_epoch_millis = params.event_time_epoch_millis;
      ctx._source.last_event_sort_key = params.last_event_sort_key;
      ctx._source.last_event_id = params.last_event_id;
      ctx._source.remove('operational_state');
      if (params.attempt_id != null) {
        ctx._source.attempt_id = params.attempt_id;
      }
    `;

    if (
      !options.skipRuntimeFence &&
      !(await this.runtimeFence.isCurrent(data))
    ) {
      return false;
    }
    await assertActive();

    const allowUpsert = options.allowUpsert !== false;
    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.schedule,
      data.message_id,
      {
        source: scriptSource,
        params,
        ...(allowUpsert
          ? {
              upsert: baseline,
              scriptedUpsert: true,
            }
          : {}),
      },
      {
        upsert: allowUpsert,
        maxRetries: 5,
        assertActive,
      }
    );

    await assertActive();
    return result === 'updated' || result === 'created';
  }
}
