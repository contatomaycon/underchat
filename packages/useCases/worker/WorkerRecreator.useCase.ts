import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { AccountService } from '@core/services/account.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  channelsConfigCentrifugo,
  workerCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { v7 as uuidv7 } from 'uuid';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { currentTime } from '@core/common/functions/currentTime';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerRecreateCooldownError } from '@core/common/exceptions/WorkerRecreateCooldownError';
import { getWorkerRecreateAvailableAt } from '@core/common/functions/workerRecreateCooldown';
import {
  ConnectionLifecycleDebugService,
  createConnectionLifecycleDebugTraceId,
  isConnectionLifecycleDebugEnabled,
} from '@core/services/connectionLifecycleDebug.service';
import { assertNonOfficialRuntimeFeature } from '@core/common/functions/workerOfficialCapabilities';

const RECREATE_STATUS_PUBLISH_TIMEOUT_MS = Math.max(
  500,
  Math.min(
    10_000,
    Number(process.env.CONNECTION_RECREATE_STATUS_PUBLISH_TIMEOUT_MS) || 2_500
  )
);

@injectable()
export class WorkerRecreatorUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService,
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService
  ) {}

  private async validate(
    t: TFunction<'translation', undefined>,
    accountId: string
  ) {
    const existsAccountById =
      await this.accountService.existsAccountById(accountId);

    if (!existsAccountById) {
      throw new Error(t('account_not_found'));
    }
  }

  private async publishWorkerRecreateEnqueueError(
    payload: IWorkerPayload
  ): Promise<void> {
    await this.workerService.updateWorkerById(payload.account_id, {
      worker_id: payload.worker_id,
      worker_status_id: EWorkerStatus.error,
      lifecycle_operation_id: null,
    });

    const statusPayload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      worker_status_id: EWorkerStatus.error,
    };

    await Promise.all([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(payload.account_id),
        statusPayload
      ),
      this.centrifugoService.publish(channelsConfigCentrifugo(), {
        ...payload,
        worker_status_id: EWorkerStatus.error,
      }),
    ]);
  }

  private async publishLogoutInProgress(
    accountId: string,
    workerId: string
  ): Promise<void> {
    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.logoutInProgress,
      worker_id: workerId,
      account_id: accountId,
      disconnected_user: true,
    };

    try {
      await this.centrifugoService.publishSub(
        workerCentrifugoQueue(accountId),
        payload
      );
    } catch {}
  }

  private buildLifecycleMessage(input: {
    payload: IWorkerPayload;
    operationId: string;
    source?: IWorkerLifecycleQueueMessage['source'];
  }): IWorkerLifecycleQueueMessage {
    return {
      request_id: uuidv7(),
      operation_id: input.operationId,
      action: 'recreate',
      worker_id: input.payload.worker_id,
      account_id: input.payload.account_id,
      server_id: input.payload.server_id,
      worker_type_id: input.payload.worker_type_id,
      worker_status_id: input.payload.worker_status_id,
      source: input.source ?? 'worker_recreate',
      remove_session: input.payload.remove_session,
      remove_volume: input.payload.remove_volume,
      previous_worker_status_id: input.payload.previous_worker_status_id,
      debug_trace_id: input.payload.debug_trace_id,
      requested_at: currentTime(),
    };
  }

  private async enqueueLifecycleOrMarkError(
    payload: IWorkerPayload,
    message: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    try {
      await this.workerLifecycleQueueService.publish(message);
    } catch (error) {
      await this.publishWorkerRecreateEnqueueError(payload);
      throw error;
    }
  }

  private async publishRecreatingStatus(
    payload: IWorkerPayload
  ): Promise<void> {
    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(payload.account_id),
      payload
    );
  }

  private publishRecreatingStatusBestEffort(payload: IWorkerPayload): void {
    void this.withTimeout(
      this.publishRecreatingStatus(payload),
      RECREATE_STATUS_PUBLISH_TIMEOUT_MS
    ).catch(() => {});
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`operation timeout after ${timeoutMs}ms`)),
        timeoutMs
      );

      promise.then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      );
    });
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    options?: {
      remove_session?: boolean;
      remove_volume?: boolean;
      enforce_recreate_cooldown?: boolean;
      lifecycle_operation_id?: string;
      previous_worker_status_id?: EWorkerStatus;
      debug_trace_id?: string;
    }
  ): Promise<IWorkerLifecycleAck> {
    const lifecycleOperationId = options?.lifecycle_operation_id ?? uuidv7();
    const debugTraceId =
      options?.debug_trace_id ??
      (isConnectionLifecycleDebugEnabled()
        ? createConnectionLifecycleDebugTraceId('worker_recreate')
        : undefined);

    void this.connectionLifecycleDebugService.log(
      'manager.worker_recreate.start',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: accountId,
        lifecycle_operation_id: lifecycleOperationId,
        remove_session: options?.remove_session === true,
        remove_volume: options?.remove_volume === true,
      }
    );

    await this.validate(t, accountId);

    const viewWorker = await this.workerService.viewWorker(accountId, workerId);

    assertNonOfficialRuntimeFeature(
      viewWorker?.type?.id,
      t('whatsapp_official_runtime_action_not_supported')
    );

    const viewWorkerBalancer = await this.workerService.viewWorkerBalancer(
      accountId,
      workerId
    );

    if (!viewWorkerBalancer) {
      throw new Error(t('worker_balancer_not_available'));
    }

    const inputRecreate: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: workerId,
      server_id: viewWorkerBalancer.server_id,
      account_id: viewWorkerBalancer.account_id,
      worker_type_id: viewWorker?.type?.id as EWorkerType | undefined,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: lifecycleOperationId,
      debug_trace_id: debugTraceId,
      previous_worker_status_id:
        options?.previous_worker_status_id ??
        (viewWorker?.status?.id as EWorkerStatus | undefined),
      ...(options?.remove_session === true ? { remove_session: true } : {}),
      ...(options?.remove_volume === true ? { remove_volume: true } : {}),
    };

    const shouldApplyCooldown = options?.enforce_recreate_cooldown === true;
    const recreateAvailableAt = shouldApplyCooldown
      ? getWorkerRecreateAvailableAt()
      : undefined;

    if (recreateAvailableAt) {
      inputRecreate.recreate_available_at = recreateAvailableAt;
    }

    if (options?.remove_session === true) {
      await this.publishLogoutInProgress(accountId, workerId);
    }

    const inputUpdate: IUpdateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: lifecycleOperationId,
      ...(recreateAvailableAt
        ? { recreate_available_at: recreateAvailableAt }
        : {}),
      ...(options?.remove_session === true
        ? { number: null, connection_date: null }
        : {}),
    };

    const workerUpdated = shouldApplyCooldown
      ? await this.workerService.updateWorkerByIdIfRecreateAvailable(
          accountId,
          inputUpdate,
          new Date().toISOString()
        )
      : await this.workerService.updateWorkerById(accountId, inputUpdate);

    void this.connectionLifecycleDebugService.log(
      'manager.worker_recreate.db_updated',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: viewWorkerBalancer.account_id,
        worker_type_id: inputRecreate.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
        status: EWorkerStatus.recreating,
        worker_updated: workerUpdated,
      }
    );

    if (!workerUpdated && shouldApplyCooldown) {
      const currentWorker = await this.workerService.viewWorker(
        accountId,
        workerId
      );
      const currentRecreateAvailableAt =
        currentWorker?.recreate_available_at ?? null;

      throw new WorkerRecreateCooldownError(
        t('worker_recreate_cooldown_active'),
        currentRecreateAvailableAt
      );
    }

    await this.enqueueLifecycleOrMarkError(
      inputRecreate,
      this.buildLifecycleMessage({
        payload: inputRecreate,
        operationId: lifecycleOperationId,
      })
    );
    void this.connectionLifecycleDebugService.log(
      'manager.worker_recreate.lifecycle_enqueued',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: viewWorkerBalancer.account_id,
        worker_type_id: inputRecreate.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
      }
    );
    this.publishRecreatingStatusBestEffort(inputRecreate);

    const ack: IWorkerLifecycleAck = {
      code: 202,
      status: 'queued',
      queued: true,
      worker_id: workerId,
      account_id: viewWorkerBalancer.account_id,
      server_id: viewWorkerBalancer.server_id,
      worker_type_id: inputRecreate.worker_type_id,
      worker_status_id: EWorkerStatus.recreating,
      operation_id: lifecycleOperationId,
      reason:
        options?.remove_session === true ? 'reset_queued' : 'recreate_queued',
      recreate_available_at: recreateAvailableAt,
      debug_trace_id: debugTraceId,
    };

    void this.connectionLifecycleDebugService.log(
      'manager.worker_recreate.response',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: viewWorkerBalancer.account_id,
        worker_type_id: inputRecreate.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
        status: ack.status,
        reason: ack.reason,
      }
    );

    return ack;
  }
}
