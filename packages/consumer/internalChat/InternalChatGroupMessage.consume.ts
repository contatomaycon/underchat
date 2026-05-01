import { singleton, inject } from 'tsyringe';
import { InternalChatMessageBaseConsume } from './InternalChatMessageBase.consume';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { InternalChatCommandDispatcherService } from '@core/services/internalChatCommandDispatcher.service';

@singleton()
export class InternalChatGroupMessageConsume extends InternalChatMessageBaseConsume {
  private static readonly GROUP_ID =
    'group-underchat-internal-chat-group-message';

  constructor(
    @inject('Kafka') kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(InternalChatCommandDispatcherService)
    dispatcher: InternalChatCommandDispatcherService
  ) {
    super(kafka, kafkaServiceQueueService, dispatcher);
  }

  protected getTopic(
    kafkaServiceQueueService: KafkaServiceQueueService
  ): string {
    return kafkaServiceQueueService.internalChatGroupMessage();
  }

  protected getGroupId(): string {
    return InternalChatGroupMessageConsume.GROUP_ID;
  }
}
