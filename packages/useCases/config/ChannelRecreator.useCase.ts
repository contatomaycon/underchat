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
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { v7 as uuidv7 } from 'uuid';

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
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService
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

  private async onChannelRecreated(
    t: TFunction<'translation', undefined>,
    payload: IWorkerPayload
  ): Promise<void> {
    try {
      await this.workerGrpcClientService.recreateWorker(payload);
    } catch (err) {
      throw new Error(t('grpc_error'), { cause: err });
    }
  }

  private dispatchChannelRecreated(
    t: TFunction<'translation', undefined>,
    payload: IWorkerPayload
  ): void {
    void this.onChannelRecreated(t, payload).catch((err) => {
      void this.publishChannelRecreateDispatchError(payload, err).catch(
        (publishErr) => {
          console.error(
            'Failed to publish channel recreation dispatch error:',
            {
              workerId: payload.worker_id,
              accountId: payload.account_id,
              error:
                publishErr instanceof Error
                  ? publishErr.message
                  : String(publishErr),
            }
          );
        }
      );
    });
  }

  private async publishChannelRecreateDispatchError(
    payload: IWorkerPayload,
    error: unknown
  ): Promise<void> {
    console.error('Failed to dispatch channel recreation:', {
      workerId: payload.worker_id,
      accountId: payload.account_id,
      serverId: payload.server_id,
      error: error instanceof Error ? error.message : String(error),
    });

    await this.workerService.updateWorkerById(payload.account_id, {
      worker_id: payload.worker_id,
      worker_status_id: EWorkerStatus.error,
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

  async execute(
    t: TFunction<'translation', undefined>,
    channelId: string
  ): Promise<boolean> {
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
    const lifecycleOperationId = uuidv7();
    const inputRecreate: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: channelId,
      server_id: viewWorkerBalancer.server_id,
      account_id: viewWorkerBalancer.account_id,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: lifecycleOperationId,
      previous_worker_status_id: viewWorker?.status?.id as
        | EWorkerStatus
        | undefined,
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

    await Promise.all([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(inputRecreate.account_id),
        inputRecreate
      ),
      this.centrifugoService.publish(channelsConfigCentrifugo(), inputRecreate),
    ]);

    this.dispatchChannelRecreated(t, inputRecreate);

    return true;
  }
}
