import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

@injectable()
export class WorkerDeleterUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository = {
      softDeleteByWorkerId: async () => false,
    } as unknown as WorkerWhatsappOfficialConnectionRepository
  ) {}

  private async validate(
    t: TFunction<'translation', undefined>,
    workerId: string,
    accountId: string
  ) {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }
  }

  private async onWorkerDeleted(payload: IWorkerPayload): Promise<void> {
    void this.workerGrpcClientService.deleteWorker(payload).catch((err) => {
      console.error('Failed to request worker deletion via gRPC:', err);
    });
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<boolean> {
    await this.validate(t, workerId, accountId);

    const viewWorker = await this.workerService.viewWorker(accountId, workerId);

    const isOfficialWhatsapp = viewWorker?.type?.id === EWorkerType.whatsapp;

    if (isOfficialWhatsapp) {
      const deleted = await this.workerService.deleteWorkerById(
        accountId,
        workerId
      );

      if (deleted) {
        await this.workerWhatsappOfficialConnectionRepository.softDeleteByWorkerId(
          workerId
        );
      }

      const statusPayload: IBaileysConnectionState = {
        code: ECodeMessage.info,
        status: EBaileysConnectionStatus.info,
        worker_id: workerId,
        worker_name: viewWorker?.name,
        account_id: accountId,
        worker_type_id: EWorkerType.whatsapp,
        worker_status_id: EWorkerStatus.delete,
      };

      await this.centrifugoService.publishSub(
        workerCentrifugoQueue(accountId),
        statusPayload
      );

      return deleted;
    }

    const viewWorkerBalancer = await this.workerService.viewWorkerBalancer(
      accountId,
      workerId
    );

    if (!viewWorkerBalancer) {
      throw new Error(t('worker_not_found'));
    }

    const inputDeleter: IWorkerPayload = {
      action: EWorkerAction.delete,
      worker_id: workerId,
      server_id: viewWorkerBalancer.server_id,
      account_id: viewWorkerBalancer.account_id,
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(inputDeleter.account_id),
      inputDeleter
    );

    const deleted = await this.workerService.deleteWorkerById(
      accountId,
      workerId
    );

    this.onWorkerDeleted(inputDeleter);

    return deleted;
  }
}
