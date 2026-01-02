import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ConfigService } from '@core/services/config.service';
import { ChatService } from '@core/services/chat.service';

@injectable()
export class ChannelOpenConversationsCheckerUseCase {
  constructor(
    private readonly configService: ConfigService,
    private readonly chatService: ChatService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    channelId: string
  ): Promise<number> {
    const viewWorkerBalancer =
      await this.configService.viewChannelBalancer(channelId);

    if (!viewWorkerBalancer) {
      throw new Error(t('worker_not_found'));
    }

    return this.chatService.countOpenChatsByWorkerId(
      viewWorkerBalancer.account_id,
      channelId
    );
  }
}
