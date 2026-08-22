import { inject, injectable } from 'tsyringe';
import { OutboundWebhookService } from '@core/services/outboundWebhook.service';

@injectable()
export class OutboundWebhookEventsListerUseCase {
  constructor(
    @inject(OutboundWebhookService)
    private readonly outboundWebhookService: OutboundWebhookService
  ) {}

  execute() {
    return this.outboundWebhookService.listEvents();
  }
}
