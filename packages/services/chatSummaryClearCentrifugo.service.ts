import { singleton } from 'tsyringe';
import { CentrifugoService } from './centrifugo.service';
import { StreamProducerService } from './streamProducer.service';
import { KafkaServiceQueueService } from './kafkaServiceQueue.service';
import { chatClearSummaryCentrifugo } from '@core/common/functions/centrifugoQueue';
import { IClearChatSummaryRequest } from '@core/common/interfaces/IClearChatSummaryRequest';
import { Subscription } from 'centrifuge';

@singleton()
export class ChatSummaryClearCentrifugoService {
  private isListening = false;
  private subscription: Subscription | null = null;

  constructor(
    private readonly centrifugoService: CentrifugoService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  public async startListening(): Promise<void> {
    if (this.isListening) return;

    const channel = chatClearSummaryCentrifugo();

    try {
      this.subscription = await this.centrifugoService.onMessage(
        channel,
        async (data: unknown) => {
          const request = data as IClearChatSummaryRequest;

          if (!request?.chat_id || !request?.account_id) return;

          await this.streamProducerService.send(
            this.kafkaServiceQueueService.clearChatSummary(),
            {
              chat_id: request.chat_id,
              account_id: request.account_id,
            }
          );
        }
      );

      this.isListening = true;
    } catch (error) {
      console.error(
        'Error starting centrifugo listener for clear summary:',
        error
      );
      throw error;
    }
  }

  public async close(): Promise<void> {
    if (!this.isListening || !this.subscription) {
      return;
    }

    try {
      await this.centrifugoService.unsubscribe(chatClearSummaryCentrifugo());
    } finally {
      this.subscription = null;
      this.isListening = false;
    }
  }
}
