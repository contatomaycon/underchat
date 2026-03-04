import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PlanReleaseRepository } from '@core/repositories/plan/PlanRelease.repository';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';
import { AsaasInvoiceWebhookRequest } from '@core/schema/payment/Webhook/request.schema';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { paymentAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { AsaasService } from '@core/services/asaas';
import { ICreateAsaasInvoiceRequest } from '@core/common/interfaces/IAsaasInvoice';
import { AccountPaymentNfSeUpserterRepository } from '@core/repositories/account/AccountPaymentNfSeUpserter.repository';
import { NotificationMessageService } from './notificationMessage.service';
import { ENotificationTypeId } from '@core/common/enums/ENotificationType';
import Redis from 'ioredis';
import { withLock } from '@core/common/functions/withLock';

@injectable()
export class PlanReleaseService {
  constructor(
    @inject(PlanReleaseRepository)
    private readonly planReleaseRepository: PlanReleaseRepository,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(AsaasService)
    private readonly asaasService: AsaasService,
    @inject(AccountPaymentNfSeUpserterRepository)
    private readonly accountPaymentNfSeUpserterRepository: AccountPaymentNfSeUpserterRepository,
    @inject(NotificationMessageService)
    private readonly notificationMessageService: NotificationMessageService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private readonly mapAsaasStatusToPaymentStatus = (
    asaasStatus: string
  ): string | null => {
    const statusMap: Record<string, string> = {
      PENDING: EPaymentStatus.pending,
      RECEIVED: EPaymentStatus.received,
      CONFIRMED: EPaymentStatus.confirmed,
      OVERDUE: EPaymentStatus.overdue,
      REFUNDED: EPaymentStatus.refunded,
      RECEIVED_IN_CASH: EPaymentStatus.received_in_cash,
      REFUND_REQUESTED: EPaymentStatus.refund_requested,
      REFUND_IN_PROGRESS: EPaymentStatus.refund_in_progress,
      CHARGEBACK_REQUESTED: EPaymentStatus.chargeback_requested,
      CHARGEBACK_DISPUTE: EPaymentStatus.chargeback_dispute,
      AWAITING_CHARGEBACK_REVERSAL: EPaymentStatus.awaiting_chargeback_reversal,
      DUNNING_REQUESTED: EPaymentStatus.dunning_requested,
      DUNNING_RECEIVED: EPaymentStatus.dunning_received,
      AWAITING_RISK_ANALYSIS: EPaymentStatus.awaiting_risk_analysis,
    };

    return statusMap[asaasStatus] || null;
  };

  private readonly isPaymentSuccessful = (status: string): boolean => {
    return (
      status === 'RECEIVED' ||
      status === 'CONFIRMED' ||
      status === 'RECEIVED_IN_CASH'
    );
  };

  private readonly isPaymentStatusSuccessful = (
    paymentStatusId: string
  ): boolean => {
    return (
      paymentStatusId === EPaymentStatus.received ||
      paymentStatusId === EPaymentStatus.confirmed ||
      paymentStatusId === EPaymentStatus.received_in_cash
    );
  };

  private readonly addOneMonth = (date: Date): Date => {
    const result = new Date(date);
    result.setMonth(result.getMonth() + 1);
    return result;
  };

  private readonly addOneYear = (date: Date): Date => {
    const result = new Date(date);
    result.setFullYear(result.getFullYear() + 1);
    return result;
  };

  private readonly calculateNextPaymentDate = (
    paymentDate: string,
    billingPeriodId: string | null,
    currentPlanId: string | null,
    newPlanId: string,
    currentNextPaymentDate: string | null
  ): string => {
    const paymentDateObj = new Date(paymentDate);

    if (currentPlanId === newPlanId && currentNextPaymentDate) {
      const currentNextDate = new Date(currentNextPaymentDate);
      const now = new Date();

      if (currentNextDate > now) {
        if (billingPeriodId === EBillingPeriod.monthly) {
          return this.addOneMonth(currentNextDate).toISOString();
        }

        if (billingPeriodId === EBillingPeriod.annual) {
          return this.addOneYear(currentNextDate).toISOString();
        }
      }
    }

    if (billingPeriodId === EBillingPeriod.monthly) {
      return this.addOneMonth(paymentDateObj).toISOString();
    }

    if (billingPeriodId === EBillingPeriod.annual) {
      return this.addOneYear(paymentDateObj).toISOString();
    }

    return paymentDateObj.toISOString();
  };

  private readonly calculateProportionalValue = (
    currentValue: string | null,
    lastPaymentDate: string | null,
    nextPaymentDate: string | null,
    newPaymentValue: string
  ): string => {
    if (!currentValue || !lastPaymentDate || !nextPaymentDate) {
      return newPaymentValue;
    }

    const now = new Date();
    const lastDate = new Date(lastPaymentDate);
    const nextDate = new Date(nextPaymentDate);

    const totalDays = Math.ceil(
      (nextDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const daysRemaining = Math.max(
      0,
      Math.ceil((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    );

    if (totalDays <= 0 || daysRemaining <= 0) {
      return newPaymentValue;
    }

    const currentValueNum = Number(currentValue);
    const pricePerDay = currentValueNum / totalDays;
    const proportionalValue = pricePerDay * daysRemaining;

    const newPaymentValueNum = Number(newPaymentValue);
    const totalValue = proportionalValue + newPaymentValueNum;

    return Math.round(totalValue * 100) / 100 + '';
  };

  private readonly checkIfPlanAlreadyReleased = async (
    accountPaymentId: string,
    planId: string
  ): Promise<boolean> => {
    const existingPlanAccount =
      await this.planReleaseRepository.findPlanAccountByAccountPaymentId(
        accountPaymentId
      );

    if (!existingPlanAccount) {
      return false;
    }

    if (existingPlanAccount.plan_id !== planId) {
      return false;
    }

    if (!existingPlanAccount.next_payment_date) {
      return false;
    }

    const nextPaymentDate = new Date(existingPlanAccount.next_payment_date);
    const now = new Date();

    return nextPaymentDate > now;
  };

  private readonly updatePaymentStatusOnly = async (data: {
    accountPaymentId: string;
    paymentStatusId: string;
    paymentDate: string | null;
    pixTransaction: string | null;
    accountId: string;
    planId: string;
    recurringPayment: boolean;
    billingPeriodId: string | null;
    value: string;
    nextPaymentDate: string;
  }): Promise<void> => {
    await withLock(
      this.redis,
      `plan-account:${data.accountId}`,
      () =>
        this.planReleaseRepository.processPaymentAndReleasePlan({
          accountPaymentId: data.accountPaymentId,
          paymentStatusId: data.paymentStatusId,
          paymentDate: data.paymentDate,
          pixTransaction: data.pixTransaction,
          accountId: data.accountId,
          planId: data.planId,
          accountPaymentIdForPlan: data.accountPaymentId,
          recurringPayment: data.recurringPayment,
          billingPeriodId: data.billingPeriodId,
          lastPaymentDate: data.paymentDate || new Date().toISOString(),
          nextPaymentDate: data.nextPaymentDate,
          value: data.value,
          shouldReleasePlan: false,
        }),
      { ttlMs: 20000 }
    );
  };

  private readonly releasePlanForPayment = async (data: {
    accountPaymentId: string;
    paymentStatusId: string;
    paymentDate: string;
    pixTransaction: string | null;
    accountId: string;
    planId: string;
    recurringPayment: boolean;
    billingPeriodId: string | null;
    value: string;
    paymentAsaasId: string;
    shouldSendNotification?: boolean;
  }): Promise<void> => {
    const currentPlanAccount =
      await this.planReleaseRepository.findPlanAccountByAccountId(
        data.accountId
      );

    const nextPaymentDate = this.calculateNextPaymentDate(
      data.paymentDate,
      data.billingPeriodId,
      currentPlanAccount?.plan_id || null,
      data.planId,
      currentPlanAccount?.next_payment_date || null
    );

    const isSamePlan = currentPlanAccount?.plan_id === data.planId;
    const finalValue = isSamePlan
      ? this.calculateProportionalValue(
          currentPlanAccount?.value || null,
          currentPlanAccount?.last_payment_date || null,
          currentPlanAccount?.next_payment_date || null,
          data.value
        )
      : data.value;

    await withLock(
      this.redis,
      `plan-account:${data.accountId}`,
      () =>
        this.planReleaseRepository.processPaymentAndReleasePlan({
          accountPaymentId: data.accountPaymentId,
          paymentStatusId: data.paymentStatusId,
          paymentDate: data.paymentDate,
          pixTransaction: data.pixTransaction,
          accountId: data.accountId,
          planId: data.planId,
          accountPaymentIdForPlan: data.accountPaymentId,
          recurringPayment: data.recurringPayment,
          billingPeriodId: data.billingPeriodId,
          lastPaymentDate: data.paymentDate,
          nextPaymentDate,
          value: finalValue,
          shouldReleasePlan: true,
        }),
      { ttlMs: 20000 }
    );

    await this.createInvoiceForPayment(
      data.accountPaymentId,
      data.paymentAsaasId
    );

    if (data.shouldSendNotification !== false) {
      const isRenewal = currentPlanAccount !== null;
      const isTestPlan = await this.planReleaseRepository.findPlanIsTestById(
        data.planId
      );

      const notificationTypeId = this.getNotificationTypeId(
        isRenewal,
        isTestPlan
      );

      await this.notificationMessageService.sendPlanNotification(
        data.accountId,
        data.planId,
        notificationTypeId
      );
    }
  };

  private readonly processSuccessfulPayment = async (
    accountPaymentData: NonNullable<
      Awaited<
        ReturnType<
          typeof this.planReleaseRepository.findAccountPaymentByBilling
        >
      >
    >,
    paymentStatusId: string,
    paymentDate: string,
    pixTransaction: string | null,
    paymentAsaasId: string
  ): Promise<void> => {
    const isPlanAlreadyReleased = await this.checkIfPlanAlreadyReleased(
      accountPaymentData.account_payment_id,
      accountPaymentData.plan_id
    );

    if (isPlanAlreadyReleased) {
      const existingPlanAccount =
        await this.planReleaseRepository.findPlanAccountByAccountPaymentId(
          accountPaymentData.account_payment_id
        );

      await this.updatePaymentStatusOnly({
        accountPaymentId: accountPaymentData.account_payment_id,
        paymentStatusId,
        paymentDate,
        pixTransaction,
        accountId: accountPaymentData.account_id,
        planId: accountPaymentData.plan_id,
        recurringPayment: accountPaymentData.recurring_payment,
        billingPeriodId: accountPaymentData.billing_period_id,
        value: accountPaymentData.value,
        nextPaymentDate:
          existingPlanAccount?.next_payment_date || new Date().toISOString(),
      });

      await this.createInvoiceForPayment(
        accountPaymentData.account_payment_id,
        paymentAsaasId
      );

      const isRenewal = await this.checkIfPlanAccountExists(
        accountPaymentData.account_id
      );
      const isTestPlan = await this.planReleaseRepository.findPlanIsTestById(
        accountPaymentData.plan_id
      );

      const notificationTypeId = this.getNotificationTypeId(
        isRenewal,
        isTestPlan
      );

      await this.notificationMessageService.sendPlanNotification(
        accountPaymentData.account_id,
        accountPaymentData.plan_id,
        notificationTypeId
      );

      return;
    }

    await this.releasePlanForPayment({
      accountPaymentId: accountPaymentData.account_payment_id,
      paymentStatusId,
      paymentDate,
      pixTransaction,
      accountId: accountPaymentData.account_id,
      planId: accountPaymentData.plan_id,
      recurringPayment: accountPaymentData.recurring_payment,
      billingPeriodId: accountPaymentData.billing_period_id,
      value: accountPaymentData.value,
      paymentAsaasId,
      shouldSendNotification: true,
    });
  };

  private readonly processUnsuccessfulPayment = async (
    accountPaymentData: NonNullable<
      Awaited<
        ReturnType<
          typeof this.planReleaseRepository.findAccountPaymentByBilling
        >
      >
    >,
    paymentStatusId: string,
    paymentDate: string | null,
    pixTransaction: string | null
  ): Promise<void> => {
    await this.updatePaymentStatusOnly({
      accountPaymentId: accountPaymentData.account_payment_id,
      paymentStatusId,
      paymentDate,
      pixTransaction,
      accountId: accountPaymentData.account_id,
      planId: accountPaymentData.plan_id,
      recurringPayment: accountPaymentData.recurring_payment,
      billingPeriodId: accountPaymentData.billing_period_id,
      value: accountPaymentData.value,
      nextPaymentDate: new Date().toISOString(),
    });
  };

  private readonly checkIfCreditCardPlanAlreadyReleased = async (
    accountPaymentId: string,
    planId: string
  ): Promise<boolean> => {
    const existingPlanAccount =
      await this.planReleaseRepository.findPlanAccountByAccountPaymentId(
        accountPaymentId
      );

    if (!existingPlanAccount) {
      return false;
    }

    if (existingPlanAccount.plan_id !== planId) {
      return false;
    }

    if (!existingPlanAccount.next_payment_date) {
      return false;
    }

    const nextPaymentDate = new Date(existingPlanAccount.next_payment_date);
    const now = new Date();

    return nextPaymentDate > now;
  };

  processPaymentWebhook = async (
    data: AsaasInvoiceWebhookRequest
  ): Promise<void> => {
    const paymentStatusId = this.mapAsaasStatusToPaymentStatus(
      data.payment.status
    );

    if (!paymentStatusId) {
      throw new Error(`Status desconhecido: ${data.payment.status}`);
    }

    const accountPaymentData =
      await this.planReleaseRepository.findAccountPaymentByBilling(
        data.payment.id
      );

    if (!accountPaymentData) {
      throw new Error(`Pagamento não encontrado: ${data.payment.id}`);
    }

    const isSuccessful = this.isPaymentSuccessful(data.payment.status);
    const paymentDate = isSuccessful
      ? data.payment.paymentDate ||
        data.payment.confirmedDate ||
        new Date().toISOString()
      : null;

    if (isSuccessful && paymentDate) {
      await this.processSuccessfulPayment(
        accountPaymentData,
        paymentStatusId,
        paymentDate,
        data.payment.pixTransaction || null,
        data.payment.id
      );
    }

    if (!isSuccessful) {
      await this.processUnsuccessfulPayment(
        accountPaymentData,
        paymentStatusId,
        paymentDate,
        data.payment.pixTransaction || null
      );
    }

    await this.notifyPaymentStatusUpdate(
      accountPaymentData.account_id,
      data.payment.id,
      data.payment.status,
      paymentDate
    );
  };

  releasePlanForCreditCard = async (data: {
    accountPaymentId: string;
    accountId: string;
    planId: string;
    billingPeriodId: string | null;
    recurringPayment: boolean;
    value: string;
    paymentDate: string;
    paymentStatusId: string;
  }): Promise<void> => {
    const isCurrentStatusSuccessful = this.isPaymentStatusSuccessful(
      data.paymentStatusId
    );

    if (!isCurrentStatusSuccessful) {
      return;
    }

    const accountPaymentData =
      await this.planReleaseRepository.findAccountPaymentById(
        data.accountPaymentId
      );

    if (!accountPaymentData) {
      throw new Error(`Pagamento não encontrado: ${data.accountPaymentId}`);
    }

    const isPlanAlreadyReleased =
      await this.checkIfCreditCardPlanAlreadyReleased(
        data.accountPaymentId,
        data.planId
      );

    if (isPlanAlreadyReleased) {
      await this.createInvoiceForPayment(
        data.accountPaymentId,
        accountPaymentData.billing || ''
      );

      const isRenewal = await this.checkIfPlanAccountExists(data.accountId);
      const isTestPlan = await this.planReleaseRepository.findPlanIsTestById(
        data.planId
      );

      const notificationTypeId = this.getNotificationTypeId(
        isRenewal,
        isTestPlan
      );

      await this.notificationMessageService.sendPlanNotification(
        data.accountId,
        data.planId,
        notificationTypeId
      );

      return;
    }

    await this.releasePlanForPayment({
      accountPaymentId: data.accountPaymentId,
      paymentStatusId: data.paymentStatusId,
      paymentDate: data.paymentDate,
      pixTransaction: null,
      accountId: data.accountId,
      planId: data.planId,
      recurringPayment: data.recurringPayment,
      billingPeriodId: data.billingPeriodId,
      value: data.value,
      paymentAsaasId: accountPaymentData.billing || '',
      shouldSendNotification: true,
    });
  };

  private readonly sanitizeTextForInvoice = (text: string): string => {
    return text
      .replace(/\n/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/—/g, '-')
      .replace(/–/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  };

  private readonly canGenerateInvoiceForAccount = async (
    accountId: string
  ): Promise<boolean> => {
    const accountGenerateInvoice =
      await this.planReleaseRepository.findAccountGenerateInvoiceById(
        accountId
      );

    return accountGenerateInvoice === true;
  };

  private readonly getCurrentDateInSaoPaulo = (): string => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    return formatter.format(new Date());
  };

  createInvoiceForPayment = async (
    accountPaymentId: string,
    paymentAsaasId: string,
    t?: TFunction<'translation', undefined>,
    options?: {
      skipGenerateInvoiceCheck?: boolean;
      useCurrentEffectiveDate?: boolean;
    }
  ): Promise<void> => {
    const skipGenerateInvoiceCheck = options?.skipGenerateInvoiceCheck === true;
    const useCurrentEffectiveDate = options?.useCurrentEffectiveDate === true;

    const paymentData =
      await this.planReleaseRepository.findAccountPaymentById(accountPaymentId);

    if (!paymentData) {
      if (t) {
        throw new Error(t('account_payment_not_found'));
      }
      return;
    }

    if (!skipGenerateInvoiceCheck) {
      const canGenerateInvoice = await this.canGenerateInvoiceForAccount(
        paymentData.account_id
      );

      if (!canGenerateInvoice) {
        if (t) {
          throw new Error(t('account_generate_invoice_not_configured'));
        }
        return;
      }
    }

    const planData = await this.planReleaseRepository.findPlanById(
      paymentData.plan_id
    );

    if (!planData) {
      if (t) {
        throw new Error(t('plan_not_found'));
      }
      return;
    }

    const userCustomerData =
      await this.planReleaseRepository.findUserCustomerByAccountPaymentId(
        accountPaymentId
      );

    if (!userCustomerData) {
      if (t) {
        throw new Error(t('user_customer_not_found'));
      }
      return;
    }

    const existingNfse =
      await this.planReleaseRepository.findNfSeByAccountPaymentId(
        accountPaymentId
      );

    if (existingNfse) {
      if (t) {
        throw new Error(t('account_payment_nfse_already_generated'));
      }
      return;
    }

    const nfseData = await this.planReleaseRepository.findDefaultNfse();

    if (!nfseData) {
      if (t) {
        throw new Error(t('nfse_configuration_not_found'));
      }
      return;
    }

    const effectiveDate = useCurrentEffectiveDate
      ? this.getCurrentDateInSaoPaulo()
      : paymentData.payment_date
        ? new Date(paymentData.payment_date).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

    const serviceDescription = this.sanitizeTextForInvoice(
      `Nota fiscal da Fatura ${paymentAsaasId}. Descrição dos Serviços: ${planData.name}`
    );

    const observations = this.sanitizeTextForInvoice(
      planData.description || `Pagamento referente ao plano ${planData.name}`
    );

    const invoiceRequest: ICreateAsaasInvoiceRequest = {
      payment: paymentAsaasId,
      customer: userCustomerData.user_customer,
      serviceDescription,
      observations,
      value: Number(paymentData.value),
      deductions: Number(nfseData.deductions || 0),
      effectiveDate,
      municipalServiceId: nfseData.external_id?.toString(),
      municipalServiceCode: nfseData.municipal_service_code || undefined,
      municipalServiceName: nfseData.name,
      taxes: {
        retainIss: nfseData.retain_iss,
        iss: Number(nfseData.iss_value || 0),
        cofins: Number(nfseData.cofins_value || 0),
        csll: Number(nfseData.csll_value || 0),
        inss: Number(nfseData.inss_value || 0),
        ir: Number(nfseData.ir_value || 0),
        pis: Number(nfseData.pis_value || 0),
      },
    };

    const invoice = await this.asaasService.createInvoice(invoiceRequest);

    if (!invoice) {
      const errorMessage = t
        ? t('account_payment_nfse_generation_error')
        : 'Erro ao criar nota fiscal para pagamento';
      throw new Error(errorMessage);
    }

    const invoiceDataForSave = {
      ...invoice,
      status: 'SCHEDULED' as const,
    };

    await this.accountPaymentNfSeUpserterRepository.upsertAccountPaymentNfSe(
      accountPaymentId,
      invoiceDataForSave
    );
  };

  private readonly notifyPaymentStatusUpdate = async (
    accountId: string,
    paymentId: string,
    status: string,
    paymentDate: string | null
  ): Promise<void> => {
    try {
      const channel = paymentAccountCentrifugo(accountId);
      await this.centrifugoService.publishSub(channel, {
        payment_id: paymentId,
        status,
        payment_date: paymentDate,
        is_confirmed: status === 'CONFIRMED',
      });
    } catch (error) {
      console.error(
        'Erro ao notificar status do pagamento via Centrifugo:',
        error
      );
    }
  };

  private readonly checkIfPlanAccountExists = async (
    accountId: string
  ): Promise<boolean> => {
    const existingPlanAccount =
      await this.planReleaseRepository.findPlanAccountByAccountId(accountId);

    return existingPlanAccount !== null;
  };

  private readonly getNotificationTypeId = (
    isRenewal: boolean,
    isTestPlan: boolean
  ): string => {
    if (isRenewal) {
      return ENotificationTypeId.plan_renewal;
    }

    if (isTestPlan) {
      return ENotificationTypeId.test_plan_new;
    }

    return ENotificationTypeId.plan_new;
  };
}
