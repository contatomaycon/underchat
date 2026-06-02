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
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class WorkerRecreatorUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(AccountService)
    private readonly accountService: AccountService,
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

  private async onWorkerRecreated(
    t: TFunction<'translation', undefined>,
    payload: IWorkerPayload
  ): Promise<void> {
    try {
      await this.workerGrpcClientService.recreateWorker(payload);
    } catch (err) {
      throw new Error(t('grpc_error'), { cause: err });
    }
  }

  private dispatchWorkerRecreated(
    t: TFunction<'translation', undefined>,
    payload: IWorkerPayload
  ): void {
    void this.onWorkerRecreated(t, payload).catch((err) => {
      void this.publishWorkerRecreateDispatchError(payload, err).catch(
        (publishErr) => {
          console.error('Failed to publish worker recreation dispatch error:', {
            workerId: payload.worker_id,
            accountId: payload.account_id,
            error:
              publishErr instanceof Error
                ? publishErr.message
                : String(publishErr),
          });
        }
      );
    });
  }

  private async publishWorkerRecreateDispatchError(
    payload: IWorkerPayload,
    error: unknown
  ): Promise<void> {
    console.error('Failed to dispatch worker recreation:', {
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
      console.error('Failed to publish connection logout intent:', err);
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    options?: {
      remove_session?: boolean;
      remove_volume?: boolean;
      lifecycle_operation_id?: string;
      previous_worker_status_id?: EWorkerStatus;
    }
  ): Promise<boolean> {
    await this.validate(t, accountId);

    const [viewWorkerBalancer, viewWorker] = await Promise.all([
      this.workerService.viewWorkerBalancer(accountId, workerId),
      this.workerService.viewWorker(accountId, workerId),
    ]);

    if (!viewWorkerBalancer) {
      throw new Error(t('worker_balancer_not_available'));
    }

    const lifecycleOperationId = options?.lifecycle_operation_id ?? uuidv7();
    const inputRecreate: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: workerId,
      server_id: viewWorkerBalancer.server_id,
      account_id: viewWorkerBalancer.account_id,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: lifecycleOperationId,
      previous_worker_status_id:
        options?.previous_worker_status_id ??
        (viewWorker?.status?.id as EWorkerStatus | undefined),
      ...(options?.remove_session === true ? { remove_session: true } : {}),
      ...(options?.remove_volume === true ? { remove_volume: true } : {}),
    };

    if (options?.remove_session === true) {
      await this.publishLogoutInProgress(accountId, workerId);
    }

    const inputUpdate: IUpdateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: lifecycleOperationId,
      ...(options?.remove_session === true
        ? { number: null, connection_date: null }
        : {}),
    };

    await this.workerService.updateWorkerById(accountId, inputUpdate);

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(inputRecreate.account_id),
      inputRecreate
    );

    this.dispatchWorkerRecreated(t, inputRecreate);

    return true;
  }
}
