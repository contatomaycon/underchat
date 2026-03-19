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
import { UserService } from '@core/services/user.service';
import { NfseCentiEmissionService } from '@core/services/nfseCentiEmission.service';
import { NfseCentiDocumentService } from '@core/services/nfseCentiDocument.service';
import type {
  IPlanReleaseAccountPaymentData,
  IPlanReleaseAddonOnlyPaymentInput,
  IPlanReleaseCreateInvoiceOptions,
  IPlanReleaseCreditCardInput,
  IPlanReleasePaymentInput,
  IPlanReleaseReleasedPlanAccount,
  IPlanReleaseUpdatePaymentStatusInput,
} from '@core/common/interfaces/IPlanReleaseService';

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
    @inject(UserService)
    private readonly userService: UserService,
    @inject(NfseCentiEmissionService)
    private readonly nfseCentiEmissionService: NfseCentiEmissionService,
    @inject(NfseCentiDocumentService)
    private readonly nfseCentiDocumentService: NfseCentiDocumentService,
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

  private readonly mapPaymentStatusToAsaasStatus = (
    paymentStatusId: string
  ): string | null => {
    const statusMap: Record<string, string> = {
      [EPaymentStatus.pending]: 'PENDING',
      [EPaymentStatus.received]: 'RECEIVED',
      [EPaymentStatus.confirmed]: 'CONFIRMED',
      [EPaymentStatus.overdue]: 'OVERDUE',
      [EPaymentStatus.refunded]: 'REFUNDED',
      [EPaymentStatus.received_in_cash]: 'RECEIVED_IN_CASH',
      [EPaymentStatus.refund_requested]: 'REFUND_REQUESTED',
      [EPaymentStatus.refund_in_progress]: 'REFUND_IN_PROGRESS',
      [EPaymentStatus.chargeback_requested]: 'CHARGEBACK_REQUESTED',
      [EPaymentStatus.chargeback_dispute]: 'CHARGEBACK_DISPUTE',
      [EPaymentStatus.awaiting_chargeback_reversal]:
        'AWAITING_CHARGEBACK_REVERSAL',
      [EPaymentStatus.dunning_requested]: 'DUNNING_REQUESTED',
      [EPaymentStatus.dunning_received]: 'DUNNING_RECEIVED',
      [EPaymentStatus.awaiting_risk_analysis]: 'AWAITING_RISK_ANALYSIS',
    };

    return statusMap[paymentStatusId] || null;
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

  private readonly isPrePaymentStatus = (paymentStatusId: string): boolean => {
    return (
      paymentStatusId === EPaymentStatus.pending ||
      paymentStatusId === EPaymentStatus.overdue ||
      paymentStatusId === EPaymentStatus.awaiting_risk_analysis ||
      paymentStatusId === EPaymentStatus.dunning_requested
    );
  };

  private readonly isPaidToPrePaymentRegression = (
    currentPaymentStatusId: string,
    incomingPaymentStatusId: string
  ): boolean => {
    const isCurrentSuccessful = this.isPaymentStatusSuccessful(
      currentPaymentStatusId
    );
    const isIncomingSuccessful = this.isPaymentStatusSuccessful(
      incomingPaymentStatusId
    );

    return (
      isCurrentSuccessful &&
      !isIncomingSuccessful &&
      this.isPrePaymentStatus(incomingPaymentStatusId)
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

  private readonly findReleasedPlanAccountByPayment = async (
    accountPaymentId: string,
    planId: string
  ): Promise<IPlanReleaseReleasedPlanAccount | null> => {
    const existingPlanAccount =
      await this.planReleaseRepository.findPlanAccountByAccountPaymentId(
        accountPaymentId
      );

    if (!existingPlanAccount) {
      return null;
    }

    if (existingPlanAccount.plan_id !== planId) {
      return null;
    }

    return existingPlanAccount;
  };

  private readonly updatePaymentStatusOnly = async (
    data: IPlanReleaseUpdatePaymentStatusInput
  ): Promise<void> => {
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

  private readonly releaseAddonOnlyForPayment = async (
    data: IPlanReleaseAddonOnlyPaymentInput
  ): Promise<void> => {
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
          recurringPayment: false,
          billingPeriodId: null,
          lastPaymentDate: data.paymentDate,
          nextPaymentDate: data.paymentDate,
          value: '0',
          shouldReleasePlan: false,
          isAddonOnly: true,
        }),
      { ttlMs: 20000 }
    );

    await this.createInvoiceForPayment(
      data.accountPaymentId,
      data.paymentAsaasId
    );
  };

  private readonly releasePlanForPayment = async (
    data: IPlanReleasePaymentInput
  ): Promise<void> => {
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
    accountPaymentData: IPlanReleaseAccountPaymentData,
    paymentStatusId: string,
    paymentDate: string,
    pixTransaction: string | null,
    paymentAsaasId: string
  ): Promise<void> => {
    if (accountPaymentData.is_addon_only) {
      await this.releaseAddonOnlyForPayment({
        accountPaymentId: accountPaymentData.account_payment_id,
        paymentStatusId,
        paymentDate,
        pixTransaction,
        accountId: accountPaymentData.account_id,
        planId: accountPaymentData.plan_id,
        paymentAsaasId,
      });

      return;
    }

    const releasedPlanAccount = await this.findReleasedPlanAccountByPayment(
      accountPaymentData.account_payment_id,
      accountPaymentData.plan_id
    );

    if (releasedPlanAccount) {
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
          releasedPlanAccount.next_payment_date || new Date().toISOString(),
      });

      await this.createInvoiceForPayment(
        accountPaymentData.account_payment_id,
        paymentAsaasId
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

  private readonly processAlreadySuccessfulPayment = async (
    accountPaymentData: IPlanReleaseAccountPaymentData,
    paymentStatusId: string,
    paymentDate: string,
    pixTransaction: string | null,
    paymentAsaasId: string
  ): Promise<void> => {
    const releasedPlanAccount = await this.findReleasedPlanAccountByPayment(
      accountPaymentData.account_payment_id,
      accountPaymentData.plan_id
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
        releasedPlanAccount?.next_payment_date || new Date().toISOString(),
    });

    await this.createInvoiceForPayment(
      accountPaymentData.account_payment_id,
      paymentAsaasId
    );
  };

  private readonly processUnsuccessfulPayment = async (
    accountPaymentData: IPlanReleaseAccountPaymentData,
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

    if (
      this.isPaidToPrePaymentRegression(
        accountPaymentData.payment_status_id,
        paymentStatusId
      )
    ) {
      const safeStatus = this.mapPaymentStatusToAsaasStatus(
        accountPaymentData.payment_status_id
      );

      await this.notifyPaymentStatusUpdate(
        accountPaymentData.account_id,
        data.payment.id,
        safeStatus || data.payment.status,
        accountPaymentData.payment_date
      );

      return;
    }

    const isSuccessful = this.isPaymentStatusSuccessful(paymentStatusId);
    const wasAlreadySuccessful = this.isPaymentStatusSuccessful(
      accountPaymentData.payment_status_id
    );
    const paymentDate = isSuccessful
      ? data.payment.paymentDate ||
        data.payment.confirmedDate ||
        accountPaymentData.payment_date ||
        new Date().toISOString()
      : accountPaymentData.payment_date;

    if (isSuccessful && wasAlreadySuccessful && paymentDate) {
      await this.processAlreadySuccessfulPayment(
        accountPaymentData,
        paymentStatusId,
        paymentDate,
        data.payment.pixTransaction || null,
        data.payment.id
      );

      await this.notifyPaymentStatusUpdate(
        accountPaymentData.account_id,
        data.payment.id,
        data.payment.status,
        paymentDate
      );

      return;
    }

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
        paymentDate || null,
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

  releasePlanForCreditCard = async (
    data: IPlanReleaseCreditCardInput
  ): Promise<void> => {
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

    if (accountPaymentData.is_addon_only) {
      const alreadyProcessed =
        accountPaymentData.payment_date !== null &&
        this.isPaymentStatusSuccessful(accountPaymentData.payment_status_id);

      if (alreadyProcessed) {
        await this.createInvoiceForPayment(
          data.accountPaymentId,
          accountPaymentData.billing || ''
        );

        return;
      }

      await this.releaseAddonOnlyForPayment({
        accountPaymentId: data.accountPaymentId,
        paymentStatusId: data.paymentStatusId,
        paymentDate: data.paymentDate,
        pixTransaction: null,
        accountId: data.accountId,
        planId: data.planId,
        paymentAsaasId: accountPaymentData.billing || '',
      });

      return;
    }

    const releasedPlanAccount = await this.findReleasedPlanAccountByPayment(
      data.accountPaymentId,
      data.planId
    );

    if (releasedPlanAccount) {
      await this.createInvoiceForPayment(
        data.accountPaymentId,
        accountPaymentData.billing || ''
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
    options?: IPlanReleaseCreateInvoiceOptions
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

    if (nfseData.integration_enabled) {
      let centiResult: Awaited<
        ReturnType<NfseCentiEmissionService['emitInvoice']>
      > | null = null;

      try {
        const [userView, userSensitiveData] = await Promise.all([
          this.userService.viewUserById(
            userCustomerData.user_id,
            paymentData.account_id
          ),
          this.userService.getUserSensitiveDataDecrypted(
            userCustomerData.user_id
          ),
        ]);

        const fullName = this.sanitizeTextForInvoice(
          `${userView?.user_info?.name || ''} ${userView?.user_info?.last_name || ''}`
        );

        centiResult = await this.nfseCentiEmissionService.emitInvoice({
          accountPaymentId,
          paymentAsaasId,
          userCustomer: userCustomerData.user_customer,
          invoiceRequest,
          nfseConfig: {
            integration_base_url: nfseData.integration_base_url,
            integration_uf: nfseData.integration_uf,
            integration_tenant: nfseData.integration_tenant,
            integration_username: nfseData.integration_username,
            integration_password_encrypted:
              nfseData.integration_password_encrypted,
            integration_municipality_code:
              nfseData.integration_municipality_code,
            integration_rps_series: nfseData.integration_rps_series,
            integration_prestador_document:
              nfseData.integration_prestador_document,
            integration_prestador_municipal_inscription:
              nfseData.integration_prestador_municipal_inscription,
            certificate_bucket: nfseData.certificate_bucket,
            certificate_key: nfseData.certificate_key,
            certificate_password_encrypted:
              nfseData.certificate_password_encrypted,
          },
          tomador: {
            name: fullName || planData.name,
            document: userSensitiveData?.document || null,
            email: userSensitiveData?.email || null,
            phone: userSensitiveData?.phone || null,
            address1: userSensitiveData?.address1 || null,
            address2: userSensitiveData?.address2 || null,
            district: userView?.user_address?.district || null,
            zipCode: userView?.user_address?.zip_code || null,
            municipalityCode: userView?.user_address?.city_fiscal_code || null,
            stateUf: nfseData.integration_uf || null,
          },
        });
      } catch (error) {
        console.warn('Centi emission unexpected error, fallback to Asaas.', {
          accountPaymentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (centiResult?.kind === 'success') {
        const invoiceData = {
          ...centiResult.invoice,
        };

        try {
          const uploadedDocuments =
            await this.nfseCentiDocumentService.generateAndUploadDocuments({
              accountId: paymentData.account_id,
              accountPaymentId,
              invoice: centiResult.invoice,
              rawXml: centiResult.rawResponse,
            });

          invoiceData.pdfUrl = uploadedDocuments.pdfUrl;
          invoiceData.xmlUrl = uploadedDocuments.xmlUrl;
        } catch (error) {
          console.warn(
            'Centi emitted NFSe, but document upload failed. Persisting without document URLs.',
            {
              accountPaymentId,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }

        await this.accountPaymentNfSeUpserterRepository.upsertAccountPaymentNfSe(
          accountPaymentId,
          invoiceData
        );
        return;
      }

      if (centiResult?.kind === 'ambiguous') {
        const baseMessage = t
          ? t('nfse_centi_ambiguous_response')
          : 'Resposta ambígua da Centi ao emitir NFSe.';
        const details = centiResult.messages.join(' | ');
        throw new Error(details ? `${baseMessage} ${details}` : baseMessage);
      }

      if (centiResult?.kind === 'explicit_failure') {
        console.warn('Centi emission failed, fallback to Asaas.', {
          reason: centiResult.reason,
          messages: centiResult.messages,
          accountPaymentId,
        });
      }
    }

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
