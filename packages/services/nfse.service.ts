import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { NfseViewerRepository } from '@core/repositories/config/NfseViewer.repository';
import { NfseUpdaterRepository } from '@core/repositories/config/NfseUpdater.repository';
import { ListNfseResponse } from '@core/schema/config/listNfse/response.schema';
import { UpdateNfseRequest } from '@core/schema/config/updateNfse/request.schema';
import { UpdateNfseResponse } from '@core/schema/config/updateNfse/response.schema';

@injectable()
export class NfseService {
  constructor(
    private readonly nfseViewerRepository: NfseViewerRepository,
    private readonly nfseUpdaterRepository: NfseUpdaterRepository
  ) {}

  viewNfse = async (): Promise<ListNfseResponse | null> => {
    return this.nfseViewerRepository.viewNfse();
  };

  upsertNfse = async (
    t: TFunction<'translation', undefined>,
    input: UpdateNfseRequest
  ): Promise<UpdateNfseResponse> => {
    return this.nfseUpdaterRepository.upsertNfse(t, input);
  };
}
