import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { WorkerRuntimeRepository } from '@core/repositories/worker/WorkerRuntime.repository';
import { DisconnectWorkerConnectionResponse } from '@core/schema/worker/disconnectWorkerConnection/response.schema';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  ConnectionLifecycleDebugService,
  createConnectionLifecycleDebugTraceId,
} from '@core/services/connectionLifecycleDebug.service';
import { WorkerService } from '@core/services/worker.service';
import { WorkerConnectionQrCodeRedisQueueService } from '@core/services/workerConnectionQrCodeRedisQueue.service';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';

const DISCONNECTABLE_WORKER_TYPES = new Set<EWorkerType>([
  EWorkerType.baileys,
  EWorkerType.wwebjs,
  EWorkerType.whatsmeow,
]);

export class WorkerConnectionDisconnectConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerConnectionDisconnectConflictError';
  }
}

export class WorkerConnectionDisconnectPostconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerConnectionDisconnectPostconditionError';
  }
}

export interface WorkerConnectionDisconnectOptions {
  debug_trace_id?: string;
}

const DISCONNECT_PROVIDER_ERROR_RECOVERY_TIMEOUT_MS = 2_000;
const DISCONNECT_PROVIDER_ERROR_RECOVERY_POLL_MS = 100;

@injectable()
export class WorkerConnectionDisconnecterUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService,
    @inject(WorkerRuntimeRepository)
    private readonly workerRuntimeRepository: WorkerRuntimeRepository,
    @inject(WorkerConnectionQrCodeRedisQueueService)
    private readonly redisQueueService: WorkerConnectionQrCodeRedisQueueService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    options: WorkerConnectionDisconnectOptions = {}
  ): Promise<DisconnectWorkerConnectionResponse> {
    const debugTraceId =
      options.debug_trace_id?.trim() ||
      createConnectionLifecycleDebugTraceId('disconnect');
    const current =
      await this.workerService.viewWorkerForMonitorConsistent(workerId);
    if (
      !current ||
      current.account_id !== accountId ||
      current.deleted_at ||
      !current.server_id ||
      !DISCONNECTABLE_WORKER_TYPES.has(current.worker_type_id)
    ) {
      throw new Error(t('worker_not_found'));
    }
    if (current.worker_status_id === EWorkerStatus.blocked) {
      throw new Error(t('worker_blocked_by_plan'));
    }
    if (current.lifecycle_operation_id) {
      throw new WorkerConnectionDisconnectConflictError(
        t('worker_connection_disconnect_lifecycle_active')
      );
    }

    const runtimeGeneration = Number(current.runtime_generation);
    const runtimeContainerId = current.runtime_container_id?.trim() || null;
    const connectionEpoch = current.connection_epoch?.trim() || null;
    if (
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0 ||
      !runtimeContainerId ||
      (current.container_id !== null &&
        current.container_id !== runtimeContainerId)
    ) {
      throw new WorkerConnectionDisconnectConflictError(
        t('worker_connection_disconnect_runtime_changed')
      );
    }

    const finalize = () =>
      this.workerRuntimeRepository.finalizeWorkerConnectionDisconnect({
        worker_id: workerId,
        account_id: accountId,
        expected_runtime_generation: runtimeGeneration,
        expected_container_id: runtimeContainerId,
        expected_connection_epoch: connectionEpoch,
      });
    const alreadyRemoved =
      (current.connection_disconnected_at ?? null) !== null &&
      (current.disconnected_connection_epoch ?? null) === connectionEpoch;

    let finalized: Awaited<ReturnType<typeof finalize>> | undefined;
    if (alreadyRemoved) {
      // A lost HTTP response must not invoke the provider clear operation a
      // second time. The durable finalizer rechecks the complete empty-session
      // postcondition and makes this retry safely idempotent.
      const existing = await finalize();
      if (
        existing.status === 'completed' ||
        (existing.status !== 'session_not_empty' &&
          existing.status !== 'session_fence_invalid')
      ) {
        finalized = existing;
      }
    }
    if (!finalized) {
      await this.invalidateQrState({
        workerId,
        accountId,
        workerTypeId: current.worker_type_id,
        runtimeGeneration,
        debugTraceId,
        source: 'manager_disconnect_preflight',
        t,
      });

      void this.connectionLifecycleDebugService.log(
        'manager.worker_connection_disconnect.provider_request',
        {
          trace_id: debugTraceId,
          layer: 'manager',
          worker_id: workerId,
          account_id: accountId,
          worker_type_id: current.worker_type_id,
          runtime_generation: runtimeGeneration,
          status: EWorkerStatus.disponible,
        }
      );

      try {
        await this.workerGrpcClientService.changeConnectionStatus(
          current.server_id,
          {
            worker_id: workerId,
            status: EWorkerStatus.disponible,
            type: EBaileysConnectionType.qrcode,
            remove_session: true,
            debug_trace_id: debugTraceId,
            runtime_generation: runtimeGeneration,
          },
          accountId
        );
      } catch (error) {
        try {
          // The provider can commit the canonical clear and then lose its
          // acknowledgement. Revalidate QR state and the complete durable
          // postcondition before surfacing a transport error to the caller.
          await this.invalidateQrState({
            workerId,
            accountId,
            workerTypeId: current.worker_type_id,
            runtimeGeneration,
            debugTraceId,
            source: 'manager_disconnect_provider_error_recovery',
            t,
          });
          const recovered = await this.finalizeAfterProviderError(finalize);
          if (recovered.status === 'completed') {
            finalized = recovered;
            void this.connectionLifecycleDebugService.log(
              'manager.worker_connection_disconnect.provider_error_recovered',
              {
                trace_id: debugTraceId,
                layer: 'manager',
                worker_id: workerId,
                account_id: accountId,
                worker_type_id: current.worker_type_id,
                runtime_generation: runtimeGeneration,
                reason: error instanceof Error ? error.message : String(error),
              }
            );
          }
        } catch (recoveryError) {
          void this.connectionLifecycleDebugService.log(
            'manager.worker_connection_disconnect.provider_error_recovery_failed',
            {
              trace_id: debugTraceId,
              layer: 'manager',
              worker_id: workerId,
              account_id: accountId,
              worker_type_id: current.worker_type_id,
              runtime_generation: runtimeGeneration,
              reason:
                recoveryError instanceof Error
                  ? recoveryError.message
                  : String(recoveryError),
            }
          );
        }
        if (!finalized) {
          throw new Error(t('grpc_error'), { cause: error });
        }
      }

      finalized ??= await finalize();
    }
    if (
      finalized.status === 'lifecycle_active' ||
      finalized.status === 'runtime_mismatch'
    ) {
      throw new WorkerConnectionDisconnectConflictError(
        t('worker_connection_disconnect_runtime_changed')
      );
    }
    if (finalized.status === 'not_found') {
      throw new Error(t('worker_not_found'));
    }
    if (finalized.status !== 'completed') {
      throw new WorkerConnectionDisconnectPostconditionError(
        t('worker_connection_disconnect_cleanup_incomplete')
      );
    }

    const terminalEvent: IBaileysConnectionState & {
      action: EWorkerAction.notify;
      server_id: string;
    } = {
      action: EWorkerAction.notify,
      event_type: 'status',
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.loggedOut,
      worker_id: workerId,
      account_id: accountId,
      server_id: current.server_id,
      worker_type_id: current.worker_type_id,
      worker_status_id: EWorkerStatus.disponible,
      disconnected_user: true,
      session_removed: true,
      runtime_generation: finalized.runtime_generation,
      container_id: finalized.container_id ?? undefined,
      worker_status_observed_at: finalized.worker_status_observed_at,
      debug_trace_id: debugTraceId,
      reason: 'worker_connection_session_removed',
    };
    const publishResults = await Promise.allSettled([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(accountId),
        terminalEvent
      ),
    ]);
    const publishFailureCount = publishResults.filter(
      (result) => result.status === 'rejected'
    ).length;
    if (publishFailureCount > 0) {
      void this.connectionLifecycleDebugService.log(
        'manager.worker_connection_disconnect.realtime_publish_failed',
        {
          trace_id: debugTraceId,
          layer: 'manager',
          worker_id: workerId,
          account_id: accountId,
          runtime_generation: finalized.runtime_generation,
          failure_count: publishFailureCount,
        }
      );
    }

    void this.connectionLifecycleDebugService.log(
      'manager.worker_connection_disconnect.completed',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: current.worker_type_id,
        runtime_generation: finalized.runtime_generation,
        status: finalized.worker_status_id,
      }
    );

    return {
      worker_id: finalized.worker_id,
      worker_status_id: finalized.worker_status_id,
      session_removed: true,
      disconnected_user: true,
      runtime_generation: finalized.runtime_generation,
      container_id: finalized.container_id,
      worker_status_observed_at: finalized.worker_status_observed_at,
      debug_trace_id: debugTraceId,
    };
  }

  private async invalidateQrState(input: {
    workerId: string;
    accountId: string;
    workerTypeId: EWorkerType;
    runtimeGeneration: number;
    debugTraceId: string;
    source: string;
    t: TFunction<'translation', undefined>;
  }): Promise<void> {
    const result = await this.redisQueueService.invalidateWorkerState(
      input.workerId,
      {
        accountId: input.accountId,
        workerTypeId: input.workerTypeId,
        reason: 'worker_connection_disconnected',
        source: input.source,
        runtimeGeneration: input.runtimeGeneration,
        debugTraceId: input.debugTraceId,
      }
    );
    if (
      (result.group_destroy_timeout_count ?? 0) > 0 ||
      (result.scan_timeout_count ?? 0) > 0 ||
      (result.delete_timeout_count ?? 0) > 0
    ) {
      throw new WorkerConnectionDisconnectPostconditionError(
        input.t('worker_connection_disconnect_qr_cleanup_failed')
      );
    }
  }

  private async finalizeAfterProviderError(
    finalize: () => ReturnType<
      WorkerRuntimeRepository['finalizeWorkerConnectionDisconnect']
    >
  ): Promise<
    Awaited<
      ReturnType<WorkerRuntimeRepository['finalizeWorkerConnectionDisconnect']>
    >
  > {
    const deadline = Date.now() + DISCONNECT_PROVIDER_ERROR_RECOVERY_TIMEOUT_MS;
    while (true) {
      const result = await finalize();
      if (
        result.status !== 'session_not_empty' &&
        result.status !== 'session_fence_invalid'
      ) {
        return result;
      }
      if (Date.now() >= deadline) {
        return result;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, DISCONNECT_PROVIDER_ERROR_RECOVERY_POLL_MS);
      });
    }
  }
}
