import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { NfseService } from '@core/services/nfse.service';
import { UpdateNfseIntegrationRequest } from '@core/schema/config/updateNfseIntegration/request.schema';
import { UpdateNfseIntegrationResponse } from '@core/schema/config/updateNfseIntegration/response.schema';

@injectable()
export class NfseIntegrationUpdaterUseCase {
  constructor(
    @inject(NfseService)
    private readonly nfseService: NfseService
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    input: UpdateNfseIntegrationRequest
  ): Promise<UpdateNfseIntegrationResponse> => {
    return this.nfseService.upsertNfseIntegration(t, input);
  };
}
