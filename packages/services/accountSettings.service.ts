import { injectable } from 'tsyringe';
import { AccountPaymentNfseViewerRepository } from '@core/repositories/accountSettings/AccountPaymentNfseViewer.repository';
import { ViewAccountPaymentNfseResponse } from '@core/schema/accountSettings/viewAccountPaymentNfse/response.schema';

@injectable()
export class AccountSettingsService {
  constructor(
    private readonly accountPaymentNfseViewerRepository: AccountPaymentNfseViewerRepository
  ) {}

  viewAccountPaymentNfse = async (
    accountId: string,
    accountPaymentId: string
  ): Promise<ViewAccountPaymentNfseResponse | null> => {
    return await this.accountPaymentNfseViewerRepository.viewAccountPaymentNfse(
      accountId,
      accountPaymentId
    );
  };
}
