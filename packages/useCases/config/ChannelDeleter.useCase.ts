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
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { IViewChannelContext } from '@core/common/interfaces/IViewChannelContext';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';

@injectable()
export class ChannelDeleterUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(ConfigService)
    private readonly configService: ConfigService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository = {
      softDeleteByWorkerId: async () => false,
    } as unknown as WorkerWhatsappOfficialConnectionRepository
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

  private async onChannelDeleted(payload: IWorkerPayload): Promise<void> {
    void this.workerGrpcClientService.deleteWorker(payload).catch((err) => {
      console.error('Failed to request channel deletion via gRPC:', err);
    });
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
        await this.workerWhatsappOfficialConnectionRepository.softDeleteByWorkerId(
          channelId
        );
      }

      const statusPayload: IBaileysConnectionState = {
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

    const viewWorkerBalancer =
      await this.configService.viewChannelBalancer(channelId);

    if (!viewWorkerBalancer) {
      throw new Error(t('worker_balancer_not_available'));
    }

    const inputDeleter: IWorkerPayload = {
      action: EWorkerAction.delete,
      worker_id: channelId,
      server_id: viewWorkerBalancer.server_id,
      account_id: channelContext.account_id,
    };

    await Promise.all([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(inputDeleter.account_id),
        inputDeleter
      ),
      this.centrifugoService.publish(channelsConfigCentrifugo(), inputDeleter),
    ]);

    const deleted = await this.workerService.deleteWorkerById(
      channelContext.account_id,
      channelId
    );

    this.onChannelDeleted(inputDeleter);

    return deleted;
  }
}
