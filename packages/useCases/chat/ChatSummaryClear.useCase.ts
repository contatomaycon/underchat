import { injectable } from 'tsyringe';
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
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly chatService: ChatService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string,
    params: ClearChatSummaryParams
  ): Promise<boolean> {
    try {
      const chat = await this.chatService.findChatByChatId(
        accountId,
        params.chat_id
      );

      if (!chat) {
        return false;
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
