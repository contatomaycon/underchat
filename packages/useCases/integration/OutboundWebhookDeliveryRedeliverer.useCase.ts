import { inject, injectable } from 'tsyringe';
import { OutboundWebhookService } from '@core/services/outboundWebhook.service';

@injectable()
export class OutboundWebhookDeliveryRedelivererUseCase {
  constructor(
    @inject(OutboundWebhookService)
    private readonly outboundWebhookService: OutboundWebhookService
  ) {}

  execute(
    accountId: string,
    webhookId: string,
    deliveryId: string,
    actorUserId: string
  ) {
    return this.outboundWebhookService.redeliver(
      accountId,
      webhookId,
      deliveryId,
      actorUserId
    );
  }
}
