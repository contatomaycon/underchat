import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { NfseService } from '@core/services/nfse.service';
import { ListNfseResponse } from '@core/schema/config/listNfse/response.schema';

@injectable()
export class NfseViewerUseCase {
  constructor(
    @inject(NfseService)
    private readonly nfseService: NfseService
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>
  ): Promise<ListNfseResponse> => {
    const nfse = await this.nfseService.viewNfse();

    if (!nfse) {
      throw new Error(t('nfse_not_found'));
    }

    return nfse;
  };
}
