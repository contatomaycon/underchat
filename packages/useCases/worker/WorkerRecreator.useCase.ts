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
import { recordConnectionLifecycle } from '@core/plugins/telemetry/connectionLifecycleDebug';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerRecreateCooldownError } from '@core/common/exceptions/WorkerRecreateCooldownError';
import { getWorkerRecreateAvailableAt } from '@core/common/functions/workerRecreateCooldown';

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
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService
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
    payload: IWorkerPayload,
    error: unknown
  ): Promise<void> {
    recordConnectionLifecycle({
      stage: 'connection.manager.worker_recreator.enqueue_error',
      decision: 'enqueue_worker_recreate',
      outcome: 'error',
      reason: 'lifecycle_enqueue_failed',
      level: 'error',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      lifecycle_operation_id: payload.lifecycle_operation_id,
      error: error instanceof Error ? error.message : String(error),
    });

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
    } catch (err) {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_recreator.logout_intent_error',
        decision: 'publish_connection_logout_intent',
        outcome: 'error',
        reason: 'publish_failed',
        level: 'error',
        worker_id: workerId,
        account_id: accountId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private buildLifecycleMessage(input: {
    payload: IWorkerPayload;
    connectionLifecycleId: string;
    operationId: string;
    source?: IWorkerLifecycleQueueMessage['source'];
  }): IWorkerLifecycleQueueMessage {
    return {
      request_id: uuidv7(),
      connection_lifecycle_id: input.connectionLifecycleId,
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
      await this.publishWorkerRecreateEnqueueError(payload, error);
      throw error;
    }
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
    }
  ): Promise<IWorkerLifecycleAck> {
    const lifecycleOperationId = options?.lifecycle_operation_id ?? uuidv7();
    const connectionLifecycleId = uuidv7();

    recordConnectionLifecycle({
      stage: 'connection.manager.worker_recreator.received',
      decision: 'recreate_worker',
      outcome: 'received',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      lifecycle_operation_id: lifecycleOperationId,
      remove_session: options?.remove_session === true,
      remove_volume: options?.remove_volume === true,
      enforce_recreate_cooldown: options?.enforce_recreate_cooldown === true,
      previous_worker_status_id: options?.previous_worker_status_id,
    });

    try {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_recreator.validation_start',
        decision: 'validate_recreate_worker',
        outcome: 'started',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        lifecycle_operation_id: lifecycleOperationId,
      });
      await this.validate(t, accountId);
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_recreator.validation_success',
        decision: 'validate_recreate_worker',
        outcome: 'success',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        lifecycle_operation_id: lifecycleOperationId,
      });
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_recreator.validation_error',
        decision: 'validate_recreate_worker',
        outcome: 'error',
        reason: 'validation_failed',
        level: 'error',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        lifecycle_operation_id: lifecycleOperationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const [viewWorkerBalancer, viewWorker] = await Promise.all([
      this.workerService.viewWorkerBalancer(accountId, workerId),
      this.workerService.viewWorker(accountId, workerId),
    ]);

    if (!viewWorkerBalancer) {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_recreator.current_runtime_missing',
        decision: 'resolve_worker_runtime',
        outcome: 'error',
        reason: 'worker_balancer_not_available',
        level: 'error',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        lifecycle_operation_id: lifecycleOperationId,
      });
      throw new Error(t('worker_balancer_not_available'));
    }
    recordConnectionLifecycle({
      stage: 'connection.manager.worker_recreator.current_runtime_resolved',
      decision: 'resolve_worker_runtime',
      outcome: 'resolved',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: viewWorkerBalancer.server_id,
      worker_type: viewWorker?.type?.id,
      worker_type_id: viewWorker?.type?.id,
      previous_worker_status_id:
        options?.previous_worker_status_id ?? viewWorker?.status?.id,
      lifecycle_operation_id: lifecycleOperationId,
    });

    const inputRecreate: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: workerId,
      server_id: viewWorkerBalancer.server_id,
      account_id: viewWorkerBalancer.account_id,
      worker_type_id: viewWorker?.type?.id as EWorkerType | undefined,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: lifecycleOperationId,
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
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_recreator.logout_intent_start',
        decision: 'publish_connection_logout_intent',
        outcome: 'started',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        server_id: viewWorkerBalancer.server_id,
        worker_type: inputRecreate.worker_type_id,
        worker_type_id: inputRecreate.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
      });
      await this.publishLogoutInProgress(accountId, workerId);
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_recreator.logout_intent_success',
        decision: 'publish_connection_logout_intent',
        outcome: 'success',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        server_id: viewWorkerBalancer.server_id,
        worker_type: inputRecreate.worker_type_id,
        worker_type_id: inputRecreate.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
      });
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

    recordConnectionLifecycle({
      stage: 'connection.manager.worker_recreator.db_update_start',
      decision: 'persist_worker_recreating_state',
      outcome: 'started',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: viewWorkerBalancer.server_id,
      worker_type: inputRecreate.worker_type_id,
      worker_type_id: inputRecreate.worker_type_id,
      lifecycle_operation_id: lifecycleOperationId,
      worker_status_id: EWorkerStatus.recreating,
      remove_session: options?.remove_session === true,
      enforce_recreate_cooldown: shouldApplyCooldown,
    });
    const workerUpdated = shouldApplyCooldown
      ? await this.workerService.updateWorkerByIdIfRecreateAvailable(
          accountId,
          inputUpdate,
          new Date().toISOString()
        )
      : await this.workerService.updateWorkerById(accountId, inputUpdate);

    if (!workerUpdated && shouldApplyCooldown) {
      const currentWorker = await this.workerService.viewWorker(
        accountId,
        workerId
      );
      const currentRecreateAvailableAt =
        currentWorker?.recreate_available_at ?? null;

      recordConnectionLifecycle({
        stage: 'connection.manager.worker_recreator.cooldown_active',
        decision: 'persist_worker_recreating_state',
        outcome: 'blocked',
        reason: 'recreate_cooldown_active',
        level: 'warn',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        server_id: viewWorkerBalancer.server_id,
        worker_type: inputRecreate.worker_type_id,
        worker_type_id: inputRecreate.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
        recreate_available_at: currentRecreateAvailableAt,
      });

      throw new WorkerRecreateCooldownError(
        t('worker_recreate_cooldown_active'),
        currentRecreateAvailableAt
      );
    }
    recordConnectionLifecycle({
      stage: 'connection.manager.worker_recreator.db_update_success',
      decision: 'persist_worker_recreating_state',
      outcome: 'success',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: viewWorkerBalancer.server_id,
      worker_type: inputRecreate.worker_type_id,
      worker_type_id: inputRecreate.worker_type_id,
      lifecycle_operation_id: lifecycleOperationId,
      worker_status_id: EWorkerStatus.recreating,
      remove_session: options?.remove_session === true,
      enforce_recreate_cooldown: shouldApplyCooldown,
      recreate_available_at: recreateAvailableAt,
    });

    recordConnectionLifecycle({
      stage: 'connection.manager.worker_recreator.centrifugo_publish_start',
      decision: 'publish_worker_recreating_state',
      outcome: 'started',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: viewWorkerBalancer.server_id,
      worker_type: inputRecreate.worker_type_id,
      worker_type_id: inputRecreate.worker_type_id,
      lifecycle_operation_id: lifecycleOperationId,
      worker_status_id: EWorkerStatus.recreating,
      centrifugo_channel: workerCentrifugoQueue(inputRecreate.account_id),
    });
    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(inputRecreate.account_id),
      inputRecreate
    );
    recordConnectionLifecycle({
      stage: 'connection.manager.worker_recreator.centrifugo_publish_success',
      decision: 'publish_worker_recreating_state',
      outcome: 'success',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: viewWorkerBalancer.server_id,
      worker_type: inputRecreate.worker_type_id,
      worker_type_id: inputRecreate.worker_type_id,
      lifecycle_operation_id: lifecycleOperationId,
      worker_status_id: EWorkerStatus.recreating,
    });

    await this.enqueueLifecycleOrMarkError(
      inputRecreate,
      this.buildLifecycleMessage({
        payload: inputRecreate,
        connectionLifecycleId,
        operationId: lifecycleOperationId,
      })
    );

    const ack: IWorkerLifecycleAck = {
      code: 202,
      status: 'queued',
      queued: true,
      worker_id: workerId,
      account_id: viewWorkerBalancer.account_id,
      server_id: viewWorkerBalancer.server_id,
      worker_type_id: inputRecreate.worker_type_id,
      worker_status_id: EWorkerStatus.recreating,
      connection_lifecycle_id: connectionLifecycleId,
      operation_id: lifecycleOperationId,
      reason:
        options?.remove_session === true ? 'reset_queued' : 'recreate_queued',
      recreate_available_at: recreateAvailableAt,
    };
    recordConnectionLifecycle({
      stage: 'connection.manager.worker_recreator.ack_returned',
      decision: 'recreate_worker',
      outcome: 'queued',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: viewWorkerBalancer.account_id,
      server_id: viewWorkerBalancer.server_id,
      worker_type: inputRecreate.worker_type_id,
      worker_type_id: inputRecreate.worker_type_id,
      lifecycle_operation_id: lifecycleOperationId,
      worker_status_id: EWorkerStatus.recreating,
      remove_session: options?.remove_session === true,
      remove_volume: options?.remove_volume === true,
      reason: ack.reason,
    });

    return ack;
  }
}
