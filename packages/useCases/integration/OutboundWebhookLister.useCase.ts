import { inject, injectable } from 'tsyringe';
import { OutboundWebhookService } from '@core/services/outboundWebhook.service';

@injectable()
export class OutboundWebhookListerUseCase {
  constructor(
    @inject(OutboundWebhookService)
    private readonly outboundWebhookService: OutboundWebhookService
  ) {}

  execute(accountId: string) {
    return this.outboundWebhookService.list(accountId);
  }
}
