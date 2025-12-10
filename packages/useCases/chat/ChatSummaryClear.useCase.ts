import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ClearChatSummaryParams } from '@core/schema/chat/clearChatSummary/request.schema';
import { IClearChatSummaryMessage } from '@core/common/interfaces/IClearChatSummaryMessage';

@injectable()
export class ChatSummaryClearUseCase {
  constructor(
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: ClearChatSummaryParams
  ): Promise<boolean> {
    try {
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
