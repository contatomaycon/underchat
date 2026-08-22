import { inject, injectable } from 'tsyringe';
import { OutboundWebhookService } from '@core/services/outboundWebhook.service';
import type { CreateOutboundWebhookRequest } from '@core/schema/integration/outboundWebhook/request.schema';

@injectable()
export class OutboundWebhookCreatorUseCase {
  constructor(
    @inject(OutboundWebhookService)
    private readonly outboundWebhookService: OutboundWebhookService
  ) {}

  execute(accountId: string, input: CreateOutboundWebhookRequest) {
    return this.outboundWebhookService.create(accountId, input);
  }
}
