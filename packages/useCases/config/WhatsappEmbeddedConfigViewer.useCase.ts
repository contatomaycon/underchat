import { inject, injectable } from 'tsyringe';
import { WhatsappEmbeddedService } from '@core/services/whatsappEmbedded.service';
import { ViewWhatsappEmbeddedConfigResponse } from '@core/schema/config/viewWhatsappEmbeddedConfig/response.schema';

@injectable()
export class WhatsappEmbeddedConfigViewerUseCase {
  constructor(
    @inject(WhatsappEmbeddedService)
    private readonly whatsappEmbeddedService: WhatsappEmbeddedService
  ) {}

  async execute(): Promise<ViewWhatsappEmbeddedConfigResponse> {
    return this.whatsappEmbeddedService.viewConfig();
  }
}
