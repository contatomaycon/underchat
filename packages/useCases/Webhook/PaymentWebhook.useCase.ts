import { injectable } from 'tsyringe';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { AsaasPaymentWebhookRequest } from '@core/schema/payment/Webhook/request.schema';

@injectable()
export class PaymentWebhookUseCase {
  constructor(
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  execute = async (input: AsaasPaymentWebhookRequest): Promise<void> => {
    const topic = this.kafkaServiceQueueService.asaasPaymentWebhook();

    await this.streamProducerService.send(topic, input, input.payment.id);
  };
}
