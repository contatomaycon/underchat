import { inject, injectable } from 'tsyringe';
import { OutboundWebhookService } from '@core/services/outboundWebhook.service';

@injectable()
export class OutboundWebhookTesterUseCase {
  constructor(
    @inject(OutboundWebhookService)
    private readonly outboundWebhookService: OutboundWebhookService
  ) {}

  execute(accountId: string, webhookId: string, actorUserId: string) {
    return this.outboundWebhookService.enqueueTest(
      accountId,
      webhookId,
      actorUserId
    );
  }
}
