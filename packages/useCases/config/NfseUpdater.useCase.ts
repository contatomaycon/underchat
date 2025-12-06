import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { NfseService } from '@core/services/nfse.service';
import { UpdateNfseRequest } from '@core/schema/config/updateNfse/request.schema';
import { UpdateNfseResponse } from '@core/schema/config/updateNfse/response.schema';

@injectable()
export class NfseUpdaterUseCase {
  constructor(
    @inject(NfseService)
    private readonly nfseService: NfseService
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    input: UpdateNfseRequest
  ): Promise<UpdateNfseResponse> => {
    return await this.nfseService.upsertNfse(t, input);
  };
}
