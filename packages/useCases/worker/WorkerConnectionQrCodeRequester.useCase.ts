import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import type { MessageHeader } from 'node-rdkafka';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import {
  IWorkerConnectionQrCodeQueueMessage,
  WorkerConnectionQrCodeQueueSource,
} from '@core/common/interfaces/IWorkerConnectionQrCodeQueueMessage';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { WorkerService } from '@core/services/worker.service';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { WorkerConnectionQrCodeReadinessService } from '@core/services/workerConnectionQrCodeReadiness.service';
import {
  buildConnectionLifecycleContext,
  recordConnectionLifecycle,
  runWithConnectionLifecycleContext,
} from '@core/plugins/telemetry/connectionLifecycleDebug';
import { recordConnectionQrSummary } from '@core/plugins/telemetry/connectionQrSummary';
import { recordConnectionAttemptTelemetry } from '@core/plugins/telemetry/connectionAttemptTelemetry';
import { getErrorMessage } from '@core/common/functions/toError';

interface ActiveQrAttempt {
  ack: IBaileysConnectionState;
  queued_at: string;
  topic: string;
  source: WorkerConnectionQrCodeQueueSource;
  worker_type_id?: string;
}

@injectable()
export class WorkerConnectionQrCodeRequesterUseCase {
  private readonly activeAttemptTtlSeconds = Math.max(
    180,
    Number(process.env.CONNECTION_QRCODE_ACTIVE_ATTEMPT_TTL_SECONDS) || 600
  );
  private readonly activeAttemptRequeueAfterMs = Math.max(
    1,
    Number(process.env.CONNECTION_QRCODE_ACTIVE_ATTEMPT_REQUEUE_MS) || 30_000
  );
  private readonly cachedQrMaxAgeMs = 120_000;
  private readonly supportedWorkerTypes = new Set<string>([
    EWorkerType.baileys,
    EWorkerType.wwebjs,
    EWorkerType.whatsmeow,
  ]);

  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WorkerConnectionQrCodeReadinessService)
    private readonly readinessService: WorkerConnectionQrCodeReadinessService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    source: WorkerConnectionQrCodeQueueSource = 'manager'
  ): Promise<IBaileysConnectionState> {
    const contextData = buildConnectionLifecycleContext({
      account_id: accountId,
      worker_id: workerId,
      channel_id: workerId,
      source_provider: 'manager',
      connection_type: EBaileysConnectionType.qrcode,
      connection_action: 'request_qrcode',
    });

    return runWithConnectionLifecycleContext(contextData, async () => {
      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.received',
        decision: 'queue_connection_qrcode_request',
        outcome: 'received',
        source,
      });

      return this.executeWithLifecycle(t, accountId, workerId, source);
    });
  }

  private async executeWithLifecycle(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    source: WorkerConnectionQrCodeQueueSource
  ): Promise<IBaileysConnectionState> {
    const existsWorkerAccountById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );
    recordConnectionLifecycle({
      stage: 'connection.manager.qrcode_request.worker_validation',
      decision: 'exists_worker_by_id',
      outcome: existsWorkerAccountById ? 'success' : 'error',
      reason: existsWorkerAccountById ? undefined : 'worker_not_found',
      level: existsWorkerAccountById ? 'info' : 'warn',
    });

    if (!existsWorkerAccountById) {
      throw new Error(t('worker_not_found'));
    }

    const view = await this.workerService.viewWorker(accountId, workerId);
    const workerTypeId = view?.type?.id;
    const workerStatusId = view?.status?.id;
    const serverId = view?.server?.id;

    if (!view || !serverId || !workerTypeId) {
      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.worker_view_validation',
        decision: 'view_worker',
        outcome: 'error',
        reason: 'worker_view_missing_required_fields',
        level: 'warn',
        server_id: serverId,
        worker_type: workerTypeId,
        worker_status_id: workerStatusId,
      });
      throw new Error(t('worker_not_found'));
    }

    if (!this.supportedWorkerTypes.has(workerTypeId)) {
      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.worker_type_validation',
        decision: 'validate_worker_type_supports_qrcode',
        outcome: 'error',
        reason: 'worker_type_not_supported',
        level: 'warn',
        server_id: serverId,
        worker_type: workerTypeId,
        worker_type_id: workerTypeId,
      });
      throw new Error(t('worker_type_invalid'));
    }

    if (workerStatusId !== EWorkerStatus.disponible) {
      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.worker_status_validation',
        decision: 'validate_worker_status_disponible',
        outcome: 'not_ready',
        reason: 'worker_status_not_disponible',
        level: 'warn',
        server_id: serverId,
        worker_type: workerTypeId,
        worker_type_id: workerTypeId,
        worker_status_id: workerStatusId,
      });
      throw new Error(t('worker_qrcode_not_ready'));
    }

    const ready = await this.readinessService.isReady({
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: workerTypeId,
    });

    if (!ready) {
      recordConnectionLifecycle({
        stage:
          'connection.manager.qrcode_request.consumer_readiness_validation',
        decision: 'validate_qrcode_consumer_ready',
        outcome: 'not_ready',
        reason: 'qrcode_consumer_not_ready',
        level: 'warn',
        server_id: serverId,
        worker_type: workerTypeId,
        worker_type_id: workerTypeId,
        worker_status_id: workerStatusId,
      });
      throw new Error(t('worker_qrcode_not_ready'));
    }

    let existing = await this.getActiveAttempt(workerId);
    if (existing) {
      const invalidReason = await this.getActiveAttemptInvalidReason(
        workerId,
        workerTypeId,
        existing
      );

      if (invalidReason) {
        await this.redis.del(this.activeAttemptKey(workerId));
        recordConnectionLifecycle({
          stage: 'connection.manager.qrcode_request.active_attempt_invalid',
          decision: 'validate_active_qrcode_attempt',
          outcome: 'invalidated',
          reason: invalidReason,
          level: 'warn',
          server_id: serverId,
          worker_type: workerTypeId,
          worker_type_id: workerTypeId,
          connection_attempt_id: existing.ack.connection_attempt_id,
          connection_lifecycle_id: existing.ack.connection_lifecycle_id,
          topic: existing.topic,
          source: existing.source,
          active_worker_type_id: existing.worker_type_id,
        });
        existing = null;
      }
    }

    const cachedQr = await this.getCachedQrAttemptState(
      workerId,
      accountId,
      workerTypeId,
      workerStatusId
    );
    if (cachedQr?.qrcode) {
      const response = this.hydrateCachedQrResponse(cachedQr, existing);

      await this.publishCachedQr(response, {
        server_id: serverId,
        worker_type_id: workerTypeId,
        source,
      });

      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.cached_qr_returned',
        decision: 'return_cached_qrcode',
        outcome: 'success',
        reason: 'cached_qr_available',
        server_id: serverId,
        worker_type: workerTypeId,
        worker_type_id: workerTypeId,
        connection_attempt_id: response.connection_attempt_id,
        connection_lifecycle_id: response.connection_lifecycle_id,
        qr_pending: false,
      });
      recordConnectionAttemptTelemetry({
        event: 'manager_qrcode_request_cached_qr_returned',
        stage: 'connection.manager.qrcode_request.cached_qr_returned',
        metric_event: 'qr_request',
        worker_id: workerId,
        account_id: accountId,
        server_id: serverId,
        worker_type: workerTypeId,
        connection_attempt_id: response.connection_attempt_id,
        connection_lifecycle_id: response.connection_lifecycle_id,
        status: response.status,
        code: response.code,
        outcome: 'success',
        reason: 'cached_qr_available',
        has_qr: true,
      });

      return response;
    }

    if (existing) {
      const existingConnectionAttemptId = existing.ack.connection_attempt_id;
      if (!existingConnectionAttemptId) {
        await this.redis.del(this.activeAttemptKey(workerId));
        recordConnectionLifecycle({
          stage: 'connection.manager.qrcode_request.active_attempt_invalid',
          decision: 'validate_active_qrcode_attempt',
          outcome: 'error',
          reason: 'active_attempt_missing_connection_attempt_id',
          level: 'warn',
          server_id: serverId,
          worker_type: workerTypeId,
          worker_type_id: workerTypeId,
          topic: existing.topic,
          source: existing.source,
        });
      } else {
        const activeAttemptAgeMs = this.getActiveAttemptAgeMs(existing);
        if (this.shouldRequeueActiveAttempt(existing, activeAttemptAgeMs)) {
          await this.clearActiveAttempt(workerId, existingConnectionAttemptId);
          recordConnectionLifecycle({
            stage: 'connection.manager.qrcode_request.active_attempt_requeue',
            decision: 'requeue_stale_pending_qrcode_attempt',
            outcome: 'requeued',
            reason: 'active_pending_attempt_exceeded_requeue_threshold',
            level: 'warn',
            server_id: serverId,
            worker_type: workerTypeId,
            worker_type_id: workerTypeId,
            connection_attempt_id: existingConnectionAttemptId,
            connection_lifecycle_id: existing.ack.connection_lifecycle_id,
            topic: existing.topic,
            source: existing.source,
            qr_pending_age_ms: activeAttemptAgeMs,
            threshold_ms: this.activeAttemptRequeueAfterMs,
          });
          recordConnectionAttemptTelemetry({
            event: 'manager_qrcode_request_active_attempt_requeued',
            stage: 'connection.manager.qrcode_request.active_attempt_requeue',
            metric_event: 'qr_request',
            level: 'warn',
            worker_id: workerId,
            account_id: accountId,
            server_id: serverId,
            worker_type: workerTypeId,
            connection_attempt_id: existingConnectionAttemptId,
            connection_lifecycle_id: existing.ack.connection_lifecycle_id,
            status: existing.ack.status,
            code: existing.ack.code,
            outcome: 'requeued',
            reason: 'stale_pending_attempt',
            qr_pending_age_ms: activeAttemptAgeMs,
          });
        } else {
          const response = {
            ...existing.ack,
            reason: 'queued',
            qr_pending: true,
            qrcode: undefined,
            pairing_code: undefined,
          };

          await this.publishPendingAck(response, {
            server_id: serverId,
            worker_type_id: workerTypeId,
            topic: existing.topic,
            source: existing.source,
          });

          recordConnectionLifecycle({
            stage: 'connection.manager.qrcode_request.duplicate_active_attempt',
            decision: 'return_existing_qrcode_attempt_ack',
            outcome: 'deduped',
            reason: 'active_connection_attempt_exists',
            server_id: serverId,
            worker_type: workerTypeId,
            worker_type_id: workerTypeId,
            connection_attempt_id: existingConnectionAttemptId,
            connection_lifecycle_id: existing.ack.connection_lifecycle_id,
            topic: existing.topic,
            source: existing.source,
            qr_pending_age_ms: activeAttemptAgeMs,
          });
          recordConnectionAttemptTelemetry({
            event: 'manager_qrcode_request_duplicate_active_attempt',
            stage: 'connection.manager.qrcode_request.duplicate_active_attempt',
            metric_event: 'qr_request',
            level: 'warn',
            worker_id: workerId,
            account_id: accountId,
            server_id: serverId,
            worker_type: workerTypeId,
            connection_attempt_id: existingConnectionAttemptId,
            connection_lifecycle_id: existing.ack.connection_lifecycle_id,
            status: existing.ack.status,
            code: existing.ack.code,
            outcome: 'deduped',
            reason: 'active_connection_attempt_exists',
            qr_pending_age_ms: activeAttemptAgeMs,
          });
          return response;
        }
      }
    }

    const connectionAttemptId = uuidv7();
    const lifecycleContext = buildConnectionLifecycleContext();
    const topic =
      this.kafkaBaileysQueueService.workerConnectionQrCode(workerId);
    const ack = this.buildPendingResponse(
      accountId,
      workerId,
      connectionAttemptId,
      lifecycleContext.connection_lifecycle_id
    );

    const activeAttempt: ActiveQrAttempt = {
      ack,
      queued_at: new Date().toISOString(),
      topic,
      source,
      worker_type_id: workerTypeId,
    };

    const claimed = await this.claimActiveAttempt(workerId, activeAttempt);
    if (!claimed) {
      const current = await this.getActiveAttempt(workerId);
      if (current) {
        return {
          ...current.ack,
          reason: 'queued',
          qr_pending: true,
          qrcode: undefined,
          pairing_code: undefined,
        };
      }

      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.active_attempt_claim_failed',
        decision: 'claim_active_qrcode_attempt',
        outcome: 'error',
        reason: 'active_attempt_claim_failed_without_current_attempt',
        level: 'warn',
        server_id: serverId,
        worker_type: workerTypeId,
        worker_type_id: workerTypeId,
        connection_attempt_id: connectionAttemptId,
        connection_lifecycle_id: lifecycleContext.connection_lifecycle_id,
      });
      throw new Error(t('worker_qrcode_not_ready'));
    }

    const payload: IWorkerConnectionQrCodeQueueMessage = {
      request_id: uuidv7(),
      connection_attempt_id: connectionAttemptId,
      connection_lifecycle_id: lifecycleContext.connection_lifecycle_id,
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: workerTypeId,
      source,
      requested_at: new Date().toISOString(),
    };

    try {
      await this.kafkaBaileysQueueService.ensure(workerId);
      await this.streamProducerService.send(
        topic,
        payload,
        workerId,
        this.buildKafkaHeaders(lifecycleContext.connection_lifecycle_id)
      );

      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.kafka_enqueued',
        decision: 'enqueue_connection_qrcode_request',
        outcome: 'queued',
        server_id: serverId,
        worker_type: workerTypeId,
        worker_type_id: workerTypeId,
        connection_attempt_id: connectionAttemptId,
        connection_lifecycle_id: lifecycleContext.connection_lifecycle_id,
        topic,
        kafka_key: workerId,
        source,
      });
      recordConnectionAttemptTelemetry({
        event: 'manager_qrcode_request_queued',
        stage: 'connection.manager.qrcode_request.kafka_enqueued',
        metric_event: 'qr_request',
        worker_id: workerId,
        account_id: accountId,
        server_id: serverId,
        worker_type: workerTypeId,
        connection_attempt_id: connectionAttemptId,
        connection_lifecycle_id: lifecycleContext.connection_lifecycle_id,
        status: ack.status,
        code: ack.code,
        outcome: 'queued',
        reason: 'queued',
      });
    } catch (error) {
      await this.clearActiveAttempt(workerId, connectionAttemptId);
      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.kafka_enqueue_error',
        decision: 'enqueue_connection_qrcode_request',
        outcome: 'error',
        reason: 'kafka_enqueue_failed',
        level: 'error',
        server_id: serverId,
        worker_type: workerTypeId,
        worker_type_id: workerTypeId,
        connection_attempt_id: connectionAttemptId,
        connection_lifecycle_id: lifecycleContext.connection_lifecycle_id,
        topic,
        error: getErrorMessage(error),
      });
      throw error;
    }

    await this.publishPendingAck(ack, {
      server_id: serverId,
      worker_type_id: workerTypeId,
      topic,
      source,
    });

    return ack;
  }

  private activeAttemptKey(workerId: string): string {
    return `connection:qrcode:${workerId}:active_attempt`;
  }

  private processedAttemptKey(
    workerId: string,
    connectionAttemptId: string
  ): string {
    return `connection:qrcode:${workerId}:processed:${connectionAttemptId}`;
  }

  private qrAttemptCacheKey(workerId: string): string {
    return `connection:qrcode:${workerId}:attempt`;
  }

  private async getActiveAttemptInvalidReason(
    workerId: string,
    workerTypeId: string,
    attempt: ActiveQrAttempt
  ): Promise<string | undefined> {
    const connectionAttemptId = attempt.ack.connection_attempt_id;
    if (!connectionAttemptId) {
      return 'active_attempt_missing_connection_attempt_id';
    }

    if (attempt.worker_type_id && attempt.worker_type_id !== workerTypeId) {
      return 'active_attempt_worker_type_mismatch';
    }

    const processed = await this.redis.get(
      this.processedAttemptKey(workerId, connectionAttemptId)
    );
    if (processed) {
      return 'active_attempt_already_processed';
    }

    return undefined;
  }

  private async getActiveAttempt(
    workerId: string
  ): Promise<ActiveQrAttempt | null> {
    const raw = await this.redis.get(this.activeAttemptKey(workerId));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as ActiveQrAttempt;
      if (!parsed?.ack?.connection_attempt_id) {
        return null;
      }
      return parsed;
    } catch {
      await this.redis.del(this.activeAttemptKey(workerId));
      return null;
    }
  }

  private async getCachedQrAttemptState(
    workerId: string,
    accountId: string,
    workerTypeId: string,
    workerStatusId?: string
  ): Promise<IBaileysConnectionState | null> {
    const raw = await this.redis.get(this.qrAttemptCacheKey(workerId));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<IBaileysConnectionState>;
      if (parsed.worker_id !== workerId || parsed.account_id !== accountId) {
        return null;
      }

      if (!parsed.worker_type_id || parsed.worker_type_id !== workerTypeId) {
        recordConnectionLifecycle({
          stage: 'connection.manager.qrcode_request.cached_qr_ignored',
          decision: 'validate_cached_qrcode_worker_type',
          outcome: 'ignored',
          reason: parsed.worker_type_id
            ? 'cached_qr_worker_type_mismatch'
            : 'cached_qr_missing_worker_type',
          level: 'warn',
          worker_type: workerTypeId,
          worker_type_id: workerTypeId,
          cached_worker_type_id: parsed.worker_type_id,
          worker_status_id: workerStatusId,
          connection_attempt_id: parsed.connection_attempt_id,
          connection_lifecycle_id: parsed.connection_lifecycle_id,
        });
        return null;
      }

      if (!parsed.qrcode) {
        return null;
      }

      if (this.isCachedQrExpired(parsed)) {
        recordConnectionLifecycle({
          stage: 'connection.manager.qrcode_request.cached_qr_ignored',
          decision: 'validate_cached_qrcode',
          outcome: 'ignored',
          reason: 'cached_qr_expired',
          level: 'warn',
          worker_status_id: workerStatusId,
          connection_attempt_id: parsed.connection_attempt_id,
          connection_lifecycle_id: parsed.connection_lifecycle_id,
        });
        return null;
      }

      return {
        ...parsed,
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId as EWorkerType,
        worker_status_id: workerStatusId as EWorkerStatus | undefined,
        qr_pending: false,
      } as IBaileysConnectionState;
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.cached_qr_read_error',
        decision: 'read_cached_qrcode',
        outcome: 'error',
        reason: 'cached_qr_parse_failed',
        level: 'warn',
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  private isCachedQrExpired(state: Partial<IBaileysConnectionState>): boolean {
    if (!state.qrcode) {
      return true;
    }

    if (!state.qr_generated_at) {
      return false;
    }

    const generatedAtMs = Date.parse(state.qr_generated_at);
    if (!Number.isFinite(generatedAtMs)) {
      return true;
    }

    return Date.now() - generatedAtMs >= this.cachedQrMaxAgeMs;
  }

  private hydrateCachedQrResponse(
    cached: IBaileysConnectionState,
    activeAttempt: ActiveQrAttempt | null
  ): IBaileysConnectionState {
    return {
      ...cached,
      connection_attempt_id:
        cached.connection_attempt_id ??
        activeAttempt?.ack.connection_attempt_id,
      connection_lifecycle_id:
        cached.connection_lifecycle_id ??
        activeAttempt?.ack.connection_lifecycle_id,
      qr_pending: false,
      reason: cached.reason ?? 'cached_qr_available',
    };
  }

  private async claimActiveAttempt(
    workerId: string,
    attempt: ActiveQrAttempt
  ): Promise<boolean> {
    const result = await this.redis.set(
      this.activeAttemptKey(workerId),
      JSON.stringify(attempt),
      'EX',
      this.activeAttemptTtlSeconds,
      'NX'
    );
    return result === 'OK';
  }

  private getActiveAttemptAgeMs(attempt: ActiveQrAttempt): number | undefined {
    const queuedAtMs = Date.parse(attempt.queued_at);
    if (!Number.isFinite(queuedAtMs)) {
      return undefined;
    }

    return Math.max(0, Date.now() - queuedAtMs);
  }

  private shouldRequeueActiveAttempt(
    attempt: ActiveQrAttempt,
    activeAttemptAgeMs: number | undefined
  ): boolean {
    return (
      attempt.ack.qr_pending === true &&
      !attempt.ack.qrcode &&
      activeAttemptAgeMs !== undefined &&
      activeAttemptAgeMs >= this.activeAttemptRequeueAfterMs
    );
  }

  private async clearActiveAttempt(
    workerId: string,
    connectionAttemptId: string
  ): Promise<void> {
    const current = await this.getActiveAttempt(workerId);
    if (current?.ack.connection_attempt_id !== connectionAttemptId) {
      return;
    }
    await this.redis.del(this.activeAttemptKey(workerId));
  }

  private buildKafkaHeaders(connectionLifecycleId: string): MessageHeader[] {
    return [
      {
        'x-connection-lifecycle-id': connectionLifecycleId,
      },
    ];
  }

  private async publishPendingAck(
    ack: IBaileysConnectionState,
    context: {
      server_id: string;
      worker_type_id: string;
      topic: string;
      source: WorkerConnectionQrCodeQueueSource;
    }
  ): Promise<void> {
    try {
      await this.centrifugoService.publishSub(
        workerCentrifugoQueue(ack.account_id),
        ack
      );
      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.pending_ack_published',
        decision: 'publish_pending_qrcode_ack',
        outcome: 'published',
        worker_id: ack.worker_id,
        account_id: ack.account_id,
        worker_type: context.worker_type_id,
        worker_type_id: context.worker_type_id,
        server_id: context.server_id,
        connection_attempt_id: ack.connection_attempt_id,
        connection_lifecycle_id: ack.connection_lifecycle_id,
        topic: context.topic,
        source: context.source,
        qr_pending: true,
      });
      recordConnectionQrSummary({
        event: 'manager_qrcode_request_pending_ack_published',
        ...ack,
        server_id: context.server_id,
        worker_type: context.worker_type_id,
        reason: 'queued',
        publish_source: 'manager',
        qr_pending: true,
      });
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.pending_ack_publish_error',
        decision: 'publish_pending_qrcode_ack',
        outcome: 'error',
        reason: 'centrifugo_publish_failed',
        level: 'warn',
        worker_id: ack.worker_id,
        account_id: ack.account_id,
        worker_type: context.worker_type_id,
        worker_type_id: context.worker_type_id,
        server_id: context.server_id,
        connection_attempt_id: ack.connection_attempt_id,
        connection_lifecycle_id: ack.connection_lifecycle_id,
        topic: context.topic,
        error: getErrorMessage(error),
      });
    }
  }

  private async publishCachedQr(
    state: IBaileysConnectionState,
    context: {
      server_id: string;
      worker_type_id: string;
      source: WorkerConnectionQrCodeQueueSource;
    }
  ): Promise<void> {
    try {
      await this.centrifugoService.publishSub(
        workerCentrifugoQueue(state.account_id),
        state
      );
      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.cached_qr_published',
        decision: 'publish_cached_qrcode',
        outcome: 'published',
        worker_id: state.worker_id,
        account_id: state.account_id,
        worker_type: context.worker_type_id,
        worker_type_id: context.worker_type_id,
        server_id: context.server_id,
        connection_attempt_id: state.connection_attempt_id,
        connection_lifecycle_id: state.connection_lifecycle_id,
        source: context.source,
        qr_pending: false,
        has_qr: true,
      });
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.cached_qr_publish_error',
        decision: 'publish_cached_qrcode',
        outcome: 'error',
        reason: 'centrifugo_publish_failed',
        level: 'warn',
        worker_id: state.worker_id,
        account_id: state.account_id,
        worker_type: context.worker_type_id,
        worker_type_id: context.worker_type_id,
        server_id: context.server_id,
        connection_attempt_id: state.connection_attempt_id,
        connection_lifecycle_id: state.connection_lifecycle_id,
        error: getErrorMessage(error),
      });
    }
  }

  private buildPendingResponse(
    accountId: string,
    workerId: string,
    connectionAttemptId: string,
    connectionLifecycleId: string
  ): IBaileysConnectionState {
    return {
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: workerId,
      account_id: accountId,
      connection_attempt_id: connectionAttemptId,
      connection_lifecycle_id: connectionLifecycleId,
      qr_pending: true,
      reason: 'queued',
    };
  }
}
