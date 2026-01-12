import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountSettingsService } from '@core/services/accountSettings.service';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import { GenerateAccountPaymentNfseResponse } from '@core/schema/accountSettings/generateAccountPaymentNfse/response.schema';

@injectable()
export class AccountPaymentNfseGeneratorUseCase {
  constructor(
    @inject(AccountSettingsService)
    private readonly accountSettingsService: AccountSettingsService
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    accountPaymentId: string
  ): Promise<GenerateAccountPaymentNfseResponse> => {
    const payment = await this.accountSettingsService.findAccountPaymentById(
      accountId,
      accountPaymentId
    );

    if (!payment) {
      throw new Error(t('account_payment_not_found'));
    }

    const paidStatuses = [
      EPaymentStatus.received,
      EPaymentStatus.confirmed,
      EPaymentStatus.received_in_cash,
      EPaymentStatus.dunning_received,
    ];

    if (!paidStatuses.includes(payment.payment_status_id as EPaymentStatus)) {
      throw new Error(t('account_payment_not_paid'));
    }

    const existingNfse =
      await this.accountSettingsService.findNfSeByAccountPaymentId(
        accountPaymentId
      );

    if (existingNfse) {
      throw new Error(t('account_payment_nfse_already_generated'));
    }

    await this.accountSettingsService.generateAccountPaymentNfse(
      t,
      accountPaymentId,
      payment.billing,
      true
    );

    return {
      success: true,
      message: t('account_payment_nfse_generation_started'),
    };
  };
}
