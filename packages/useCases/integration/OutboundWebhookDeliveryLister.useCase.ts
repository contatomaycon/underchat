import { inject, injectable } from 'tsyringe';
import { OutboundWebhookService } from '@core/services/outboundWebhook.service';

@injectable()
export class OutboundWebhookDeliveryListerUseCase {
  constructor(
    @inject(OutboundWebhookService)
    private readonly outboundWebhookService: OutboundWebhookService
  ) {}

  execute(
    accountId: string,
    webhookId: string,
    limit?: number,
    cursor?: string
  ) {
    return this.outboundWebhookService.listDeliveries(
      accountId,
      webhookId,
      limit,
      cursor
    );
  }
}
