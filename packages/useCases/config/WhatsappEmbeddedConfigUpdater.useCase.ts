import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WhatsappEmbeddedService } from '@core/services/whatsappEmbedded.service';
import { UpdateWhatsappEmbeddedConfigRequest } from '@core/schema/config/updateWhatsappEmbeddedConfig/request.schema';
import { ViewWhatsappEmbeddedConfigResponse } from '@core/schema/config/viewWhatsappEmbeddedConfig/response.schema';

@injectable()
export class WhatsappEmbeddedConfigUpdaterUseCase {
  constructor(
    @inject(WhatsappEmbeddedService)
    private readonly whatsappEmbeddedService: WhatsappEmbeddedService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: UpdateWhatsappEmbeddedConfigRequest
  ): Promise<ViewWhatsappEmbeddedConfigResponse> {
    return this.whatsappEmbeddedService.updateConfig(t, input);
  }
}
