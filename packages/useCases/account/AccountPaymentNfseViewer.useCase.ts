import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountPaymentService } from '@core/services/accountPayment.service';
import { ViewAccountPaymentNfseResponse } from '@core/schema/account/viewAccountPaymentNfse/response.schema';

@injectable()
export class AccountPaymentNfseViewerUseCase {
  constructor(
    @inject(AccountPaymentService)
    private readonly accountPaymentService: AccountPaymentService
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    accountPaymentId: string
  ): Promise<ViewAccountPaymentNfseResponse> => {
    const nfse = await this.accountPaymentService.viewAccountPaymentNfse(
      accountId,
      accountPaymentId
    );

    if (!nfse) {
      throw new Error(t('account_payment_nfse_not_found'));
    }

    return nfse;
  };
}
