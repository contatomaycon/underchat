import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountPaymentService } from '@core/services/accountPayment.service';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import { GenerateAccountPaymentNfseResponse } from '@core/schema/account/generateAccountPaymentNfse/response.schema';

@injectable()
export class AccountPaymentNfseGeneratorUseCase {
  constructor(
    @inject(AccountPaymentService)
    private readonly accountPaymentService: AccountPaymentService
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    accountPaymentId: string
  ): Promise<GenerateAccountPaymentNfseResponse> => {
    const payment = await this.accountPaymentService.findAccountPaymentById(
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
      await this.accountPaymentService.findNfSeByAccountPaymentId(
        accountPaymentId
      );

    if (existingNfse) {
      throw new Error(t('account_payment_nfse_already_generated'));
    }

    await this.accountPaymentService.generateAccountPaymentNfse(
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
