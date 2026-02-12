import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ChatService } from '@core/services/chat.service';
import { ClearChatSummaryParams } from '@core/schema/chat/clearChatSummary/request.schema';
import { IClearChatSummaryMessage } from '@core/common/interfaces/IClearChatSummaryMessage';
import { EChatStatus } from '@core/common/enums/EChatStatus';

@injectable()
export class ChatSummaryClearUseCase {
  constructor(
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ChatService)
    private readonly chatService: ChatService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string,
    params: ClearChatSummaryParams,
    userChannels: { id: string; name: string }[] = []
  ): Promise<boolean> {
    try {
      const chat = await this.chatService.findChatByChatId(
        accountId,
        params.chat_id
      );

      if (!chat) {
        return false;
      }

      if (userChannels.length > 0) {
        const channelIds = userChannels.map((c) => c.id);
        if (!chat.worker?.id || !channelIds.includes(chat.worker.id)) {
          return false;
        }
      }

      if (chat.status !== EChatStatus.in_chat) {
        return false;
      }

      if (chat.user?.id !== userId) {
        return false;
      }

      const message: IClearChatSummaryMessage = {
        chat_id: params.chat_id,
        account_id: accountId,
      };

      await this.streamProducerService.send(
        this.kafkaServiceQueueService.clearChatSummary(),
        message
      );

      return true;
    } catch {
      throw new Error(t('chat_summary_clear_failed'));
    }
  }
}
