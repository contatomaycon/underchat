import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

@injectable()
export class WorkerChangeStatusConnectionUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService
  ) {}

  private cleanPhoneNumber(phone?: string): string {
    return phone ? phone.replaceAll(/\D/g, '') : '';
  }

  private async validate(
    t: TFunction<'translation', undefined>,
    input: StatusConnectionWorkerRequest,
    accountId: string
  ) {
    if (input.type === EBaileysConnectionType.phone) {
      throw new Error(t('phone_connection_disabled'));
    }

    const existsWorkerAccountById = await this.workerService.existsWorkerById(
      accountId,
      input.worker_id
    );

    if (!existsWorkerAccountById) {
      throw new Error(t('worker_not_found'));
    }
  }

  private async onChangeConnectionStatus(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: StatusConnectionWorkerRequest
  ): Promise<void> {
    const view = await this.workerService.viewWorker(
      accountId,
      input.worker_id
    );
    const serverId = view?.server?.id;
    if (!serverId) {
      throw new Error(t('worker_not_found'));
    }

    const cleanPhone = this.cleanPhoneNumber(input.phone_connection);
    const payload: StatusConnectionWorkerRequest = {
      worker_id: input.worker_id,
      status: input.status,
      type: input.type,
      phone_connection: cleanPhone,
      remove_session: input.remove_session,
    };

    try {
      await this.workerGrpcClientService.changeConnectionStatus(
        serverId,
        payload,
        accountId
      );
    } catch (err) {
      throw new Error(t('grpc_error'), { cause: err });
    }
  }

  private async publishConnectionIntent(
    accountId: string,
    input: StatusConnectionWorkerRequest
  ): Promise<void> {
    if (input.status !== EWorkerStatus.online) {
      if (input.status !== EWorkerStatus.disponible) {
        return;
      }

      try {
        await this.centrifugoService.publishSub(
          workerCentrifugoQueue(accountId),
          {
            status: EBaileysConnectionStatus.connecting,
            worker_id: input.worker_id,
            account_id: accountId,
            disconnected_user: true,
            code: ECodeMessage.logoutInProgress,
          } satisfies IBaileysConnectionState
        );
      } catch {}

      return;
    }

    try {
      await this.centrifugoService.publishSub(
        workerCentrifugoQueue(accountId),
        {
          status: EBaileysConnectionStatus.connecting,
          worker_id: input.worker_id,
          account_id: accountId,
          code: ECodeMessage.awaitConnection,
        } satisfies IBaileysConnectionState
      );
    } catch {}
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: StatusConnectionWorkerRequest
  ): Promise<void> {
    await this.validate(t, input, accountId);
    await this.publishConnectionIntent(accountId, input);
    await this.onChangeConnectionStatus(t, accountId, input);
  }
}
