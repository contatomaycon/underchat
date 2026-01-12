import { injectable, inject } from 'tsyringe';
import { PlanAccountRenewalListerRepository } from '@core/repositories/planAccount/PlanAccountRenewalLister.repository';
import { UserMasterViewerRepository } from '@core/repositories/user/UserMasterViewer.repository';
import { UserCardDefaultViewerRepository } from '@core/repositories/user/UserCardDefaultViewer.repository';
import { PaymentService } from './payment.service';
import { PlanService } from './plan.service';
import { PlanReleaseService } from './planRelease.service';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import { EPaymentBillingType } from '@core/common/enums/EPaymentBillingType';
import { IPlanAccountRenewal } from '@core/common/interfaces/IPlanAccountRenewal';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { AccountUpdaterRepository } from '@core/repositories/account/AccountUpdater.repository';
import { NotificationMessageService } from './notificationMessage.service';
import { ENotificationTypeId } from '@core/common/enums/ENotificationType';
import Redis from 'ioredis';
import { withLock } from '@core/common/functions/withLock';
import { createI18nInstance } from '@core/common/functions/createI18nInstance';

@injectable()
export class PlanRenewalService {
  private readonly concurrency = 10;

  constructor(
    private readonly planAccountRenewalListerRepository: PlanAccountRenewalListerRepository,
    private readonly userMasterViewerRepository: UserMasterViewerRepository,
    private readonly userCardDefaultViewerRepository: UserCardDefaultViewerRepository,
    private readonly paymentService: PaymentService,
    private readonly planService: PlanService,
    private readonly planReleaseService: PlanReleaseService,
    private readonly accountUpdaterRepository: AccountUpdaterRepository,
    private readonly notificationMessageService: NotificationMessageService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  processRenewals = async (): Promise<void> => {
    const planAccounts =
      await this.planAccountRenewalListerRepository.findPlanAccountsForRenewal();

    if (planAccounts.length === 0) {
      return;
    }

    for (let i = 0; i < planAccounts.length; i += this.concurrency) {
      const batch = planAccounts.slice(i, i + this.concurrency);

      await Promise.allSettled(
        batch.map((planAccount) => this.processRenewalWithLock(planAccount))
      );
    }
  };

  private readonly processRenewalWithLock = async (
    planAccount: IPlanAccountRenewal
  ): Promise<void> => {
    const lockKey = `plan-renewal:${planAccount.plan_account_id}`;

    return withLock(this.redis, lockKey, () =>
      this.processRenewal(planAccount)
    );
  };

  private readonly calculatePaymentValue = (
    planAccount: IPlanAccountRenewal
  ): number => {
    const planPrice = Number(planAccount.plan.price);
    const crossSellsTotal = planAccount.cross_sells.reduce(
      (total, crossSell) => total + Number(crossSell.price),
      0
    );

    return planPrice + crossSellsTotal;
  };

  private readonly getBillingPeriod = (
    billingPeriodId: string | null
  ): 'monthly' | 'annual' => {
    if (billingPeriodId === EBillingPeriod.annual) {
      return 'annual';
    }

    return 'monthly';
  };

  private readonly isPaymentRefused = (status: string): boolean => {
    const successfulStatuses = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

    if (successfulStatuses.includes(status)) {
      return false;
    }

    return true;
  };

  private readonly processRenewal = async (
    planAccount: IPlanAccountRenewal
  ): Promise<void> => {
    const t = await createI18nInstance('pt');

    const masterUser =
      await this.userMasterViewerRepository.findMasterUserByAccountId(
        planAccount.account_id
      );

    if (!masterUser) {
      console.warn(
        `Usuário master não encontrado para account_id: ${planAccount.account_id}`
      );

      await Promise.all([
        this.accountUpdaterRepository.updateAccountStatusById(
          planAccount.account_id,
          EAccountStatus.inactive
        ),
        this.notificationMessageService.sendPlanNotification(
          planAccount.account_id,
          planAccount.plan_id,
          ENotificationTypeId.recurring_payment_failure
        ),
      ]);

      return;
    }

    let customer;
    try {
      customer = await this.paymentService.getOrCreateCustomer(
        t,
        planAccount.account_id
      );
    } catch (error) {
      console.warn(
        `Cliente não encontrado ou não pôde ser criado para account_id: ${planAccount.account_id}`,
        error
      );

      await Promise.all([
        this.accountUpdaterRepository.updateAccountStatusById(
          planAccount.account_id,
          EAccountStatus.inactive
        ),
        this.notificationMessageService.sendPlanNotification(
          planAccount.account_id,
          planAccount.plan_id,
          ENotificationTypeId.recurring_payment_failure
        ),
      ]);

      return;
    }

    const defaultCard =
      await this.userCardDefaultViewerRepository.findDefaultUserCardByUserId(
        masterUser.user_id
      );

    if (!defaultCard) {
      console.warn(
        `Cartão padrão não encontrado para user_id: ${masterUser.user_id}`
      );

      await Promise.all([
        this.accountUpdaterRepository.updateAccountStatusById(
          planAccount.account_id,
          EAccountStatus.inactive
        ),
        this.notificationMessageService.sendPlanNotification(
          planAccount.account_id,
          planAccount.plan_id,
          ENotificationTypeId.recurring_payment_failure
        ),
      ]);

      return;
    }

    const paymentValue = this.calculatePaymentValue(planAccount);

    const paymentResult = await this.paymentService.createCreditCardPayment(
      planAccount.account_id,
      customer.user_customer,
      paymentValue,
      `Renovação automática do plano - ${planAccount.plan_id}`,
      `renewal-${planAccount.plan_account_id}-${Date.now()}`,
      '127.0.0.1',
      {
        creditCardId: defaultCard.user_card_id,
        recurringPayment: true,
      }
    );

    if (!paymentResult.payment) {
      console.error(
        `Falha ao criar pagamento para plan_account ${planAccount.plan_account_id}`
      );

      await Promise.all([
        this.accountUpdaterRepository.updateAccountStatusById(
          planAccount.account_id,
          EAccountStatus.inactive
        ),
        this.notificationMessageService.sendPlanNotification(
          planAccount.account_id,
          planAccount.plan_id,
          ENotificationTypeId.recurring_payment_failure
        ),
      ]);

      return;
    }

    const paymentStatusId =
      paymentResult.payment.status === 'RECEIVED' ||
      paymentResult.payment.status === 'CONFIRMED'
        ? EPaymentStatus.received
        : EPaymentStatus.pending;

    const accountPaymentId = await this.planService.createAccountPayment({
      accountId: planAccount.account_id,
      userCustomerId: customer.user_customer_id,
      planId: planAccount.plan_id,
      billing: paymentResult.payment.id || '',
      paymentBillingTypeId: EPaymentBillingType.credit_card,
      value: paymentValue.toString(),
      netValue:
        paymentResult.payment.netValue?.toString() || paymentValue.toString(),
      pixTransaction: null,
      paymentStatusId,
      billingPeriodId: planAccount.billing_period_id,
      invoiceUrl: paymentResult.payment.invoiceUrl || null,
      recurringPayment: true,
      userCardId: defaultCard.user_card_id,
      installment: null,
    });

    if (planAccount.cross_sells.length > 0) {
      const billingPeriod = this.getBillingPeriod(
        planAccount.billing_period_id
      );
      const addons = planAccount.cross_sells.map((crossSell) => ({
        plan_cross_sell_id: crossSell.plan_cross_sell_id,
      }));

      await this.planService.createAccountPaymentCrossSells({
        accountPaymentId,
        addons,
        billingPeriod,
      });
    }

    if (paymentStatusId === EPaymentStatus.received) {
      const paymentDate =
        paymentResult.payment.paymentDate || new Date().toISOString();

      await this.planReleaseService.releasePlanForCreditCard({
        accountPaymentId,
        accountId: planAccount.account_id,
        planId: planAccount.plan_id,
        billingPeriodId: planAccount.billing_period_id,
        recurringPayment: true,
        value: paymentValue.toString(),
        paymentDate,
        paymentStatusId,
      });
    }

    if (this.isPaymentRefused(paymentResult.payment.status)) {
      await Promise.all([
        this.accountUpdaterRepository.updateAccountStatusById(
          planAccount.account_id,
          EAccountStatus.inactive
        ),
        this.notificationMessageService.sendPlanNotification(
          planAccount.account_id,
          planAccount.plan_id,
          ENotificationTypeId.recurring_payment_failure
        ),
      ]);

      return;
    }

    await this.notificationMessageService.sendPlanNotification(
      planAccount.account_id,
      planAccount.plan_id,
      ENotificationTypeId.plan_renewal
    );
  };
}
