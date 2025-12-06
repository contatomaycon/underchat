import { injectable } from 'tsyringe';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { AsaasInvoiceWebhookRequest } from '@core/schema/invoice/Webhook/request.schema';

@injectable()
export class InvoiceWebhookUseCase {
  constructor(
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  execute = async (input: AsaasInvoiceWebhookRequest): Promise<void> => {
    const topic = this.kafkaServiceQueueService.asaasNfseWebhook();

    await this.streamProducerService.send(topic, input, input.invoice.id);
  };
}
