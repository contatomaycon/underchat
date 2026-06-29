import { inject, injectable } from 'tsyringe';
import { WhatsappEmbeddedService } from '@core/services/whatsappEmbedded.service';
import { WorkerWhatsappEmbeddedConfigResponse } from '@core/schema/worker/whatsappEmbeddedConfig/response.schema';

@injectable()
export class WhatsappEmbeddedConfigViewerUseCase {
  constructor(
    @inject(WhatsappEmbeddedService)
    private readonly whatsappEmbeddedService: WhatsappEmbeddedService
  ) {}

  async execute(): Promise<WorkerWhatsappEmbeddedConfigResponse> {
    return this.whatsappEmbeddedService.viewPublicConfig();
  }
}
