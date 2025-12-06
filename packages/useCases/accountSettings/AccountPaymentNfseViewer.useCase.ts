import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountPaymentNfseViewerRepository } from '@core/repositories/accountSettings/AccountPaymentNfseViewer.repository';
import { ViewAccountPaymentNfseResponse } from '@core/schema/accountSettings/viewAccountPaymentNfse/response.schema';

@injectable()
export class AccountPaymentNfseViewerUseCase {
  constructor(
    @inject(AccountPaymentNfseViewerRepository)
    private readonly accountPaymentNfseViewerRepository: AccountPaymentNfseViewerRepository
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    accountPaymentId: string
  ): Promise<ViewAccountPaymentNfseResponse> => {
    const nfse =
      await this.accountPaymentNfseViewerRepository.viewAccountPaymentNfse(
        accountId,
        accountPaymentId
      );

    if (!nfse) {
      throw new Error(t('account_payment_nfse_not_found'));
    }

    return nfse;
  };
}
