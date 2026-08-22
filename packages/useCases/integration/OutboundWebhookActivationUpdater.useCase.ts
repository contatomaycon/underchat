import { inject, injectable } from 'tsyringe';
import { OutboundWebhookService } from '@core/services/outboundWebhook.service';

@injectable()
export class OutboundWebhookActivationUpdaterUseCase {
  constructor(
    @inject(OutboundWebhookService)
    private readonly outboundWebhookService: OutboundWebhookService
  ) {}

  execute(accountId: string, webhookId: string, active: boolean) {
    return this.outboundWebhookService.setActive(accountId, webhookId, active);
  }
}
