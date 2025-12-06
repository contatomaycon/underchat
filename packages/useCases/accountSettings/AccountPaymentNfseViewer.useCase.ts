import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountSettingsService } from '@core/services/accountSettings.service';
import { ViewAccountPaymentNfseResponse } from '@core/schema/accountSettings/viewAccountPaymentNfse/response.schema';

@injectable()
export class AccountPaymentNfseViewerUseCase {
  constructor(
    @inject(AccountSettingsService)
    private readonly accountSettingsService: AccountSettingsService
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    accountPaymentId: string
  ): Promise<ViewAccountPaymentNfseResponse> => {
    const nfse = await this.accountSettingsService.viewAccountPaymentNfse(
      accountId,
      accountPaymentId
    );

    if (!nfse) {
      throw new Error(t('account_payment_nfse_not_found'));
    }

    return nfse;
  };
}
