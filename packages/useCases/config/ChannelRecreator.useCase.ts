import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { AccountService } from '@core/services/account.service';
import { ConfigService } from '@core/services/config.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  workerCentrifugoQueue,
  channelsConfigCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { v7 as uuidv7 } from 'uuid';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { currentTime } from '@core/common/functions/currentTime';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  ConnectionLifecycleDebugService,
  createConnectionLifecycleDebugTraceId,
  isConnectionLifecycleDebugEnabled,
} from '@core/services/connectionLifecycleDebug.service';
import { assertNonOfficialRuntimeFeature } from '@core/common/functions/workerOfficialCapabilities';

@injectable()
export class ChannelRecreatorUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(ConfigService)
    private readonly configService: ConfigService,
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

  private async publishChannelRecreateEnqueueError(
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

  private buildLifecycleMessage(input: {
    payload: IWorkerPayload;
    operationId: string;
    recreateServerSlot?: {
      key: string;
      token: string;
    };
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
      source: 'config_recreate',
      previous_worker_status_id: input.payload.previous_worker_status_id,
      recreate_server_slot_key: input.recreateServerSlot?.key,
      recreate_server_slot_token: input.recreateServerSlot?.token,
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
      await this.publishChannelRecreateEnqueueError(payload);
      throw error;
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    channelId: string,
    debugTraceIdInput?: string,
    options?: {
      recreate_server_slot_key?: string;
      recreate_server_slot_token?: string;
    }
  ): Promise<IWorkerLifecycleAck> {
    const debugTraceId =
      debugTraceIdInput ??
      (isConnectionLifecycleDebugEnabled()
        ? createConnectionLifecycleDebugTraceId('channel_recreate')
        : undefined);

    void this.connectionLifecycleDebugService.log(
      'manager.channel_recreate.start',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: channelId,
      }
    );

    const viewWorkerBalancer =
      await this.configService.viewChannelBalancer(channelId);

    if (!viewWorkerBalancer) {
      throw new Error(t('worker_not_found'));
    }

    await this.validate(t, viewWorkerBalancer.account_id);

    const viewWorker = await this.workerService.viewWorker(
      viewWorkerBalancer.account_id,
      channelId
    );

    assertNonOfficialRuntimeFeature(
      viewWorker?.type?.id,
      t('whatsapp_official_runtime_action_not_supported')
    );

    const lifecycleOperationId = uuidv7();
    const inputRecreate: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: channelId,
      server_id: viewWorkerBalancer.server_id,
      account_id: viewWorkerBalancer.account_id,
      worker_type_id: viewWorker?.type?.id as EWorkerType | undefined,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: lifecycleOperationId,
      debug_trace_id: debugTraceId,
      previous_worker_status_id: viewWorker?.status?.id as
        EWorkerStatus | undefined,
    };

    const inputUpdate: IUpdateWorker = {
      worker_id: channelId,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: lifecycleOperationId,
    };

    await this.workerService.updateWorkerById(
      viewWorkerBalancer.account_id,
      inputUpdate
    );
    void this.connectionLifecycleDebugService.log(
      'manager.channel_recreate.db_updated',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: channelId,
        account_id: viewWorkerBalancer.account_id,
        worker_type_id: inputRecreate.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
        status: EWorkerStatus.recreating,
      }
    );

    await Promise.all([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(inputRecreate.account_id),
        inputRecreate
      ),
      this.centrifugoService.publish(channelsConfigCentrifugo(), inputRecreate),
    ]);

    await this.enqueueLifecycleOrMarkError(
      inputRecreate,
      this.buildLifecycleMessage({
        payload: inputRecreate,
        operationId: lifecycleOperationId,
        recreateServerSlot:
          options?.recreate_server_slot_key &&
          options?.recreate_server_slot_token
            ? {
                key: options.recreate_server_slot_key,
                token: options.recreate_server_slot_token,
              }
            : undefined,
      })
    );
    void this.connectionLifecycleDebugService.log(
      'manager.channel_recreate.lifecycle_enqueued',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: channelId,
        account_id: viewWorkerBalancer.account_id,
        worker_type_id: inputRecreate.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
      }
    );

    return {
      code: 202,
      status: 'queued',
      queued: true,
      worker_id: channelId,
      account_id: viewWorkerBalancer.account_id,
      server_id: viewWorkerBalancer.server_id,
      worker_type_id: inputRecreate.worker_type_id,
      worker_status_id: EWorkerStatus.recreating,
      operation_id: lifecycleOperationId,
      reason: 'recreate_queued',
      debug_trace_id: debugTraceId,
    };
  }
}
