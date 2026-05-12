import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { WorkerService } from '@core/services/worker.service';

@injectable()
export class WorkerConnectionQrCodeRequesterUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<IBaileysConnectionState> {
    const existsWorkerAccountById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerAccountById) {
      throw new Error(t('worker_not_found'));
    }

    const view = await this.workerService.viewWorker(accountId, workerId);
    const serverId = view?.server?.id;
    if (!serverId) {
      throw new Error(t('worker_not_found'));
    }

    try {
      return await this.workerGrpcClientService.requestConnectionQrCode(
        serverId,
        {
          worker_id: workerId,
          status: EWorkerStatus.online,
          type: EBaileysConnectionType.qrcode,
        },
        accountId
      );
    } catch (err) {
      throw new Error(t('grpc_error'), { cause: err });
    }
  }
}
