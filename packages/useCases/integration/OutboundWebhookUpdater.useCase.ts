import { inject, injectable } from 'tsyringe';
import { OutboundWebhookService } from '@core/services/outboundWebhook.service';
import type { UpdateOutboundWebhookRequest } from '@core/schema/integration/outboundWebhook/request.schema';

@injectable()
export class OutboundWebhookUpdaterUseCase {
  constructor(
    @inject(OutboundWebhookService)
    private readonly outboundWebhookService: OutboundWebhookService
  ) {}

  execute(
    accountId: string,
    webhookId: string,
    input: UpdateOutboundWebhookRequest
  ) {
    return this.outboundWebhookService.update(accountId, webhookId, input);
  }
}
