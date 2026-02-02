import { injectable } from 'tsyringe';
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

@injectable()
export class ChannelDeleterUseCase {
  constructor(
    private readonly workerService: WorkerService,
    private readonly configService: ConfigService,
    private readonly centrifugoService: CentrifugoService,
    private readonly workerGrpcClientService: WorkerGrpcClientService,
    private readonly chatService: ChatService
  ) {}

  private async validate(
    t: TFunction<'translation', undefined>,
    channelId: string
  ) {
    const viewWorkerBalancer =
      await this.configService.viewChannelBalancer(channelId);

    if (!viewWorkerBalancer) {
      throw new Error(t('worker_not_found'));
    }

    const openChatsCount = await this.chatService.countOpenChatsByWorkerId(
      viewWorkerBalancer.account_id,
      channelId
    );

    if (openChatsCount > 0) {
      throw new Error(
        t('channel_delete_has_open_conversations', {
          count: openChatsCount,
        })
      );
    }
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
    await this.validate(t, channelId);

    const viewWorkerBalancer =
      await this.configService.viewChannelBalancer(channelId);

    if (!viewWorkerBalancer) {
      throw new Error(t('worker_not_found'));
    }

    const inputDeleter: IWorkerPayload = {
      action: EWorkerAction.delete,
      worker_id: channelId,
      server_id: viewWorkerBalancer.server_id,
      account_id: viewWorkerBalancer.account_id,
    };

    await Promise.all([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(inputDeleter.account_id),
        inputDeleter
      ),
      this.centrifugoService.publish(channelsConfigCentrifugo(), inputDeleter),
    ]);

    const deleted = await this.workerService.deleteWorkerById(
      viewWorkerBalancer.account_id,
      channelId
    );

    this.onChannelDeleted(inputDeleter);

    return deleted;
  }
}
