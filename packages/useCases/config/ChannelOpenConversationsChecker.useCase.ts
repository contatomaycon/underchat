import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ConfigService } from '@core/services/config.service';
import { ChatService } from '@core/services/chat.service';

@injectable()
export class ChannelOpenConversationsCheckerUseCase {
  constructor(
    @inject(ConfigService)
    private readonly configService: ConfigService,
    @inject(ChatService)
    private readonly chatService: ChatService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    channelId: string
  ): Promise<number> {
    const channelContext =
      await this.configService.viewChannelContext(channelId);

    if (!channelContext) {
      throw new Error(t('worker_not_found'));
    }

    return this.chatService.countOpenChatsByWorkerId(
      channelContext.account_id,
      channelId
    );
  }
}
