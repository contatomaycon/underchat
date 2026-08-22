import { inject, singleton } from 'tsyringe';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import {
  WORKER_COMMAND_MAX_AGE_MS,
  WORKER_COMMAND_PUBLIC_RETRY_WINDOW_MS,
} from '@core/common/constants/workerCommandTransport';
import { resolveWorkerCommandChatEntityKey } from '@core/common/functions/messageIdentity';
import { workerCommandMessagePayload } from '@core/common/functions/workerCommandMessagePayload';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { ChatService } from '@core/services/chat.service';
import { WorkerCommandAdmissionService } from '@core/services/workerCommandAdmission.service';
import { WorkerCommandLaneService } from '@core/services/workerCommandLane.service';
import {
  isWorkerCommandOperationalBarrierPausedError,
  WorkerCommandOperationalBarrierService,
} from '@core/services/workerCommandOperationalBarrier.service';

const RECONCILE_INTERVAL_MS = 15_000;
const RECONCILE_BATCH_SIZE = 200;
const RECONCILE_CONCURRENCY = 8;
const RECONCILE_MAX_PAGES_PER_RANGE = 5;

type ElasticHit<T> = { _id?: string; _source?: T; sort?: unknown[] };
type ReconcileRange = 'retry' | 'expire' | 'invalid';

export interface WorkerCommandQueuedReconcilerStatus {
  running: boolean;
  in_flight: boolean;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_error_at: string | null;
  scanned_total: number;
  republished_total: number;
  expired_total: number;
  failed_total: number;
  barrier_paused: boolean;
  barrier_skipped_total: number;
}

/**
 * Bounded recovery for the only gap left without an outbox: Elasticsearch was
 * persisted but the API process did not persist a JetStream PubAck. The same
 * immutable operation/issued-at is retried for at most two minutes. Commands
 * never get a fresh clock and are terminally expired at five minutes.
 */
@singleton()
export class WorkerCommandQueuedReconcilerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private loop: Promise<void> | null = null;
  private status: WorkerCommandQueuedReconcilerStatus = {
    running: false,
    in_flight: false,
    last_started_at: null,
    last_finished_at: null,
    last_error_at: null,
    scanned_total: 0,
    republished_total: 0,
    expired_total: 0,
    failed_total: 0,
    barrier_paused: false,
    barrier_skipped_total: 0,
  };

  constructor(
    @inject(ElasticDatabaseService)
    private readonly elastic: ElasticDatabaseService,
    @inject(ChatService) private readonly chats: ChatService,
    @inject(WorkerCommandAdmissionService)
    private readonly admission: WorkerCommandAdmissionService,
    @inject(WorkerCommandLaneService)
    private readonly lanes: WorkerCommandLaneService,
    @inject(WorkerCommandOperationalBarrierService)
    private readonly barrier: WorkerCommandOperationalBarrierService
  ) {}

  public start(options?: {
    onError?: (error: unknown) => void;
    onSuccess?: () => void;
  }): void {
    if (this.status.running) return;
    this.status.running = true;
    const run = (): void => {
      void this.runOnce()
        .then(() => options?.onSuccess?.())
        .catch((error: unknown) => {
          options?.onError?.(error);
        });
    };
    run();
    this.timer = setInterval(run, RECONCILE_INTERVAL_MS);
    this.timer.unref?.();
  }

  public async close(): Promise<void> {
    this.status.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.loop?.catch(() => undefined);
  }

  public getStatus(): WorkerCommandQueuedReconcilerStatus {
    return { ...this.status };
  }

  public async runOnce(now = new Date()): Promise<void> {
    if (this.loop) return this.loop;
    this.status.in_flight = true;
    this.status.last_started_at = now.toISOString();
    this.loop = this.barrier
      .runWithPermit('queued_reconciler', async () => {
        this.status.barrier_paused = false;
        await this.reconcile(now);
      })
      .catch((error: unknown) => {
        if (isWorkerCommandOperationalBarrierPausedError(error)) {
          this.status.barrier_paused = true;
          this.status.barrier_skipped_total += 1;
          return;
        }
        this.status.last_error_at = new Date().toISOString();
        throw error;
      })
      .finally(() => {
        this.status.in_flight = false;
        this.status.last_finished_at = new Date().toISOString();
        this.loop = null;
      });
    return this.loop;
  }

  private async reconcile(now: Date): Promise<void> {
    // Expired work and retryable work are disjoint queries. Records in the
    // intentional 2-5 minute no-retry window can never occupy a page and
    // starve fresh retries or final expiration.
    await this.reconcileRange('expire', now);
    await this.reconcileRange('retry', now);
    await this.reconcileRange('invalid', now);
  }

  private async reconcileRange(
    range: ReconcileRange,
    now: Date
  ): Promise<void> {
    let searchAfter: unknown[] | undefined;
    for (let page = 0; page < RECONCILE_MAX_PAGES_PER_RANGE; page += 1) {
      const response = await this.elastic.selectOrThrow<IChatMessage>(
        EElasticIndex.message,
        this.buildQuery(range, now, searchAfter)
      );
      const hits = (response.hits.hits ?? []) as ElasticHit<IChatMessage>[];
      this.status.scanned_total += hits.length;

      for (
        let offset = 0;
        offset < hits.length;
        offset += RECONCILE_CONCURRENCY
      ) {
        const chunk = hits.slice(offset, offset + RECONCILE_CONCURRENCY);
        await Promise.allSettled(
          chunk.map((hit) =>
            hit._source
              ? range === 'invalid'
                ? this.quarantineInvalidMessage(hit._source, now)
                : this.reconcileMessage(hit._source, now)
              : Promise.resolve()
          )
        );
      }

      if (hits.length < RECONCILE_BATCH_SIZE) return;
      const lastSort = hits.at(-1)?.sort;
      if (!Array.isArray(lastSort)) {
        throw new Error('worker_command_reconciler_search_after_missing');
      }
      searchAfter = lastSort;
    }
  }

  private buildQuery(
    range: ReconcileRange,
    now: Date,
    searchAfter?: unknown[]
  ): object {
    const nowIso = now.toISOString();
    const retryCutoffIso = new Date(
      now.getTime() - WORKER_COMMAND_PUBLIC_RETRY_WINDOW_MS
    ).toISOString();
    const clockRange =
      range === 'expire'
        ? { range: { worker_command_deadline_at: { lte: nowIso } } }
        : range === 'retry'
          ? {
              range: {
                worker_command_issued_at: {
                  gt: retryCutoffIso,
                  lte: nowIso,
                },
              },
            }
          : {
              bool: {
                should: [
                  {
                    bool: {
                      must_not: [
                        { exists: { field: 'worker_command_issued_at' } },
                      ],
                    },
                  },
                  {
                    bool: {
                      must_not: [
                        { exists: { field: 'worker_command_deadline_at' } },
                      ],
                    },
                  },
                ],
                minimum_should_match: 1,
              },
            };
    const sortField =
      range === 'expire'
        ? 'worker_command_deadline_at'
        : range === 'retry'
          ? 'worker_command_issued_at'
          : 'message_id';
    return {
      size: RECONCILE_BATCH_SIZE,
      _source: true,
      ...(searchAfter ? { search_after: searchAfter } : {}),
      query: {
        bool: {
          filter: [
            { term: { worker_command_transport: 'jetstream' } },
            { term: { sent_from_platform: true } },
            { term: { delivery_status: 'queued' } },
            clockRange,
          ],
          // Expiration also covers commands that received PubAck but were
          // never acquired by an online worker. The Redis lane CAS below is
          // the authority that prevents expiring an operation which ever
          // entered the provider path.
          ...(range === 'expire'
            ? {}
            : { must_not: [{ exists: { field: 'broker_accepted_at' } }] }),
        },
      },
      sort: [
        // Existing message indices may predate the JetStream clock fields.
        // Keep reconciliation read-only and treat an unmapped clock as an
        // empty date field while the normal message write path owns mappings.
        {
          [sortField]: {
            order: 'asc',
            ...(sortField === 'message_id' ? {} : { unmapped_type: 'date' }),
          },
        },
        ...(sortField === 'message_id'
          ? []
          : [{ message_id: { order: 'asc' } }]),
      ],
    };
  }

  private async quarantineInvalidMessage(
    message: IChatMessage,
    now: Date
  ): Promise<void> {
    try {
      await this.chats.markInvalidWorkerCommandExpired(
        message.account.id,
        message.message_id,
        now.toISOString()
      );
      this.status.expired_total += 1;
    } catch {
      this.status.failed_total += 1;
    }
  }

  private async reconcileMessage(
    message: IChatMessage,
    now: Date
  ): Promise<void> {
    try {
      const issuedAt = this.parseImmutableTimestamp(
        message.worker_command_issued_at
      );
      const expectedDeadline = new Date(
        issuedAt.getTime() + WORKER_COMMAND_MAX_AGE_MS
      );
      const storedDeadline = this.parseImmutableTimestamp(
        message.worker_command_deadline_at
      );
      if (storedDeadline.getTime() !== expectedDeadline.getTime()) {
        throw new Error('worker_command_deadline_identity_mismatch');
      }

      if (now.getTime() >= storedDeadline.getTime()) {
        const workerId = message.worker.id?.trim();
        if (!workerId) throw new Error('worker_command_worker_id_missing');
        const laneState = await this.lanes.expireNeverActive(
          message.account.id,
          workerId,
          resolveWorkerCommandChatEntityKey(
            message.account.id,
            workerId,
            message
          ),
          message.message_id
        );
        // An operation that ever owned the lane may already have crossed the
        // provider boundary. Its ledger/recovery, never the ES clock, decides
        // succeeded/failed/ambiguous. Do not mislabel or release successors.
        if (
          laneState === 'ever_active' ||
          laneState === 'predecessor_pending' ||
          (laneState.startsWith('terminal:') &&
            laneState !== 'terminal:expired')
        ) {
          return;
        }
        await this.chats.markWorkerCommandExpired(
          message.account.id,
          message.message_id,
          storedDeadline.toISOString(),
          now.toISOString()
        );
        this.status.expired_total += 1;
        return;
      }

      if (
        now.getTime() >=
        issuedAt.getTime() + WORKER_COMMAND_PUBLIC_RETRY_WINDOW_MS
      ) {
        return;
      }

      const workerId = message.worker.id?.trim();
      if (!workerId) throw new Error('worker_command_worker_id_missing');
      const result = await this.admission.admit({
        accountId: message.account.id,
        workerId,
        commandType: 'direct_send',
        entityKey: resolveWorkerCommandChatEntityKey(
          message.account.id,
          workerId,
          message
        ),
        operationId: message.message_id,
        retryOf: message.worker_command_retry_of ?? null,
        payload: workerCommandMessagePayload(message),
        source: 'queued_message_reconciler',
        retry: true,
        issuedAt,
      });
      await this.chats.markWorkerCommandAccepted(
        message.account.id,
        message.message_id,
        result.receipt
      );
      this.status.republished_total += 1;
    } catch {
      this.status.failed_total += 1;
    }
  }

  private parseImmutableTimestamp(value: string | null | undefined): Date {
    if (!value) throw new Error('worker_command_timestamp_missing');
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
      throw new Error('worker_command_timestamp_invalid');
    }
    return parsed;
  }
}
