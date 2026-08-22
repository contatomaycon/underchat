import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { enqueuePermanentWorkerDeletion } from '@core/common/functions/workerPermanentDeletionLifecycle';
import { ChatbotInactivityAlertChannelDeactivatorService } from '@core/services/chatbotInactivityAlertChannelDeactivator.service';

@injectable()
export class WorkerDeleterUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService,
    @inject(ChatbotInactivityAlertChannelDeactivatorService)
    private readonly inactivityAlertChannelDeactivator: ChatbotInactivityAlertChannelDeactivatorService
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
        await this.inactivityAlertChannelDeactivator.deactivateByChannel(
          accountId,
          workerId
        );
      }

      const statusPayload: IBaileysConnectionState = {
        event_type: 'status',
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

    const deletionMessage = await enqueuePermanentWorkerDeletion(
      {
        workerService: this.workerService,
        workerLifecycleQueueService: this.workerLifecycleQueueService,
      },
      {
        account_id: accountId,
        worker_id: workerId,
        source: 'worker_delete',
      }
    );
    if (!deletionMessage) {
      return false;
    }

    await this.inactivityAlertChannelDeactivator.deactivateByChannel(
      accountId,
      workerId
    );

    const inputDeleter: IWorkerPayload & IBaileysConnectionState = {
      event_type: 'status',
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      action: EWorkerAction.delete,
      worker_id: workerId,
      server_id: deletionMessage.server_id,
      account_id: deletionMessage.account_id,
      worker_status_id: EWorkerStatus.deleting,
      worker_type_id: deletionMessage.worker_type_id,
      lifecycle_operation_id: deletionMessage.operation_id,
      debug_trace_id: deletionMessage.debug_trace_id,
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(inputDeleter.account_id),
      inputDeleter
    );

    return true;
  }
}
