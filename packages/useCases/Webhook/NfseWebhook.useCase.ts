import { injectable } from 'tsyringe';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { AsaasNfseWebhookRequest } from '@core/schema/nfse/Webhook/request.schema';

@injectable()
export class NfseWebhookUseCase {
  constructor(
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  execute = async (input: AsaasNfseWebhookRequest): Promise<void> => {
    const topic = this.kafkaServiceQueueService.asaasNfseWebhook();

    await this.streamProducerService.send(topic, input, input.invoice.id);
  };
}
