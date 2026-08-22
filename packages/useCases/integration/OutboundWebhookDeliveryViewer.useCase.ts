import { inject, injectable } from 'tsyringe';
import { OutboundWebhookService } from '@core/services/outboundWebhook.service';

@injectable()
export class OutboundWebhookDeliveryViewerUseCase {
  constructor(
    @inject(OutboundWebhookService)
    private readonly outboundWebhookService: OutboundWebhookService
  ) {}

  execute(accountId: string, webhookId: string, deliveryId: string) {
    return this.outboundWebhookService.viewDelivery(
      accountId,
      webhookId,
      deliveryId
    );
  }
}
