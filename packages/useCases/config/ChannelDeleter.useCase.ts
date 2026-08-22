import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { ConfigService } from '@core/services/config.service';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { ChatService } from '@core/services/chat.service';
import {
  workerCentrifugoQueue,
  channelsConfigCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IViewChannelContext } from '@core/common/interfaces/IViewChannelContext';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { enqueuePermanentWorkerDeletion } from '@core/common/functions/workerPermanentDeletionLifecycle';
import { ChatbotInactivityAlertChannelDeactivatorService } from '@core/services/chatbotInactivityAlertChannelDeactivator.service';

@injectable()
export class ChannelDeleterUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(ConfigService)
    private readonly configService: ConfigService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(ChatbotInactivityAlertChannelDeactivatorService)
    private readonly inactivityAlertChannelDeactivator: ChatbotInactivityAlertChannelDeactivatorService
  ) {}

  private async validate(
    t: TFunction<'translation', undefined>,
    channelId: string
  ): Promise<IViewChannelContext> {
    const channelContext =
      await this.configService.viewChannelContext(channelId);

    if (!channelContext) {
      throw new Error(t('worker_not_found'));
    }

    const openChatsCount = await this.chatService.countOpenChatsByWorkerId(
      channelContext.account_id,
      channelId
    );

    if (openChatsCount > 0) {
      throw new Error(
        t('channel_delete_has_open_conversations', {
          count: openChatsCount,
        })
      );
    }

    return channelContext;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    channelId: string
  ): Promise<boolean> {
    const channelContext = await this.validate(t, channelId);
    const isOfficialWhatsapp =
      channelContext.worker_type_id === EWorkerType.whatsapp;

    if (isOfficialWhatsapp) {
      const deleted = await this.workerService.deleteWorkerById(
        channelContext.account_id,
        channelId
      );

      if (deleted) {
        await this.inactivityAlertChannelDeactivator.deactivateByChannel(
          channelContext.account_id,
          channelId
        );
      }

      const statusPayload: IBaileysConnectionState = {
        event_type: 'status',
        code: ECodeMessage.info,
        status: EBaileysConnectionStatus.info,
        worker_id: channelId,
        worker_name: channelContext.name,
        account_id: channelContext.account_id,
        worker_type_id: EWorkerType.whatsapp,
        worker_status_id: EWorkerStatus.delete,
      };

      await Promise.all([
        this.centrifugoService.publishSub(
          workerCentrifugoQueue(channelContext.account_id),
          statusPayload
        ),
        this.centrifugoService.publish(
          channelsConfigCentrifugo(),
          statusPayload
        ),
      ]);

      return deleted;
    }

    const deletionMessage = await enqueuePermanentWorkerDeletion(
      {
        workerService: this.workerService,
        workerLifecycleQueueService: this.workerLifecycleQueueService,
      },
      {
        account_id: channelContext.account_id,
        worker_id: channelId,
        source: 'channel_delete',
      }
    );
    if (!deletionMessage) {
      return false;
    }

    await this.inactivityAlertChannelDeactivator.deactivateByChannel(
      channelContext.account_id,
      channelId
    );

    const inputDeleter: IWorkerPayload & IBaileysConnectionState = {
      event_type: 'status',
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      action: EWorkerAction.delete,
      worker_id: channelId,
      server_id: deletionMessage.server_id,
      account_id: channelContext.account_id,
      worker_status_id: EWorkerStatus.deleting,
      worker_type_id: deletionMessage.worker_type_id,
      lifecycle_operation_id: deletionMessage.operation_id,
      debug_trace_id: deletionMessage.debug_trace_id,
    };

    await Promise.all([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(inputDeleter.account_id),
        inputDeleter
      ),
      this.centrifugoService.publish(channelsConfigCentrifugo(), inputDeleter),
    ]);

    return true;
  }
}
