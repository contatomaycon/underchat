import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountPaymentNfseViewerRepository } from '@core/repositories/accountSettings/AccountPaymentNfseViewer.repository';
import { ViewAccountPaymentNfseResponse } from '@core/schema/accountSettings/viewAccountPaymentNfse/response.schema';
import { PlanReleaseRepository } from '@core/repositories/plan/PlanRelease.repository';
import { PlanReleaseService } from '@core/services/planRelease.service';

@injectable()
export class AccountSettingsService {
  constructor(
    @inject(AccountPaymentNfseViewerRepository)
    private readonly accountPaymentNfseViewerRepository: AccountPaymentNfseViewerRepository,
    @inject(PlanReleaseRepository)
    private readonly planReleaseRepository: PlanReleaseRepository,
    @inject(PlanReleaseService)
    private readonly planReleaseService: PlanReleaseService
  ) {}

  viewAccountPaymentNfse = async (
    accountId: string,
    accountPaymentId: string
  ): Promise<ViewAccountPaymentNfseResponse | null> => {
    return this.accountPaymentNfseViewerRepository.viewAccountPaymentNfse(
      accountId,
      accountPaymentId
    );
  };

  findAccountPaymentById = async (
    accountId: string,
    accountPaymentId: string
  ): Promise<{
    account_payment_id: string;
    account_id: string;
    plan_id: string;
    billing_period_id: string | null;
    recurring_payment: boolean;
    value: string;
    payment_date: string | null;
    payment_status_id: string;
    billing: string;
  } | null> => {
    const payment =
      await this.planReleaseRepository.findAccountPaymentById(accountPaymentId);

    if (!payment) {
      return null;
    }

    if (payment.account_id !== accountId) {
      return null;
    }

    return payment;
  };

  findNfSeByAccountPaymentId = async (
    accountPaymentId: string
  ): Promise<{ account_payment_nfse_id: string } | null> => {
    return this.planReleaseRepository.findNfSeByAccountPaymentId(
      accountPaymentId
    );
  };

  generateAccountPaymentNfse = async (
    t: TFunction<'translation', undefined>,
    accountPaymentId: string,
    paymentAsaasId: string,
    isManual: boolean = false
  ): Promise<void> => {
    const paymentData =
      await this.planReleaseRepository.findAccountPaymentById(accountPaymentId);
    if (!paymentData) {
      throw new Error(t('account_payment_not_found'));
    }

    if (!isManual) {
      const accountGenerateInvoice =
        await this.planReleaseRepository.findAccountGenerateInvoiceById(
          paymentData.account_id
        );

      if (!accountGenerateInvoice) {
        throw new Error(t('account_generate_invoice_not_configured'));
      }
    }

    const planData = await this.planReleaseRepository.findPlanById(
      paymentData.plan_id
    );
    if (!planData) {
      throw new Error(t('plan_not_found'));
    }

    const userCustomerData =
      await this.planReleaseRepository.findUserCustomerByAccountPaymentId(
        accountPaymentId
      );
    if (!userCustomerData) {
      throw new Error(t('user_customer_not_found'));
    }

    const existingNfse =
      await this.planReleaseRepository.findNfSeByAccountPaymentId(
        accountPaymentId
      );
    if (existingNfse) {
      throw new Error(t('account_payment_nfse_already_generated'));
    }

    const nfseData = await this.planReleaseRepository.findDefaultNfse();
    if (!nfseData) {
      throw new Error(t('nfse_configuration_not_found'));
    }

    return this.planReleaseService.createInvoiceForPayment(
      accountPaymentId,
      paymentAsaasId,
      t,
      {
        skipGenerateInvoiceCheck: isManual,
      }
    );
  };
}
