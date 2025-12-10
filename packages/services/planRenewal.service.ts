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
import Redis from 'ioredis';
import { withLock } from '@core/common/functions/withLock';

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
    @inject('Redis') private readonly redis: Redis
  ) {}

  processRenewals = async (): Promise<void> => {
    const planAccounts =
      await this.planAccountRenewalListerRepository.findPlanAccountsForRenewal();

    console.log('planAccounts');
    console.dir(planAccounts, { depth: null, colors: true });

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

  private readonly processRenewal = async (
    planAccount: IPlanAccountRenewal
  ): Promise<void> => {
    const [masterUser, customer] = await Promise.all([
      this.userMasterViewerRepository.findMasterUserByAccountId(
        planAccount.account_id
      ),
      this.paymentService.getOrCreateCustomer(planAccount.account_id),
    ]);

    if (!masterUser) {
      console.warn(
        `Usuário master não encontrado para account_id: ${planAccount.account_id}`
      );

      return;
    }

    if (!customer) {
      console.warn(
        `Cliente não encontrado ou não pôde ser criado para account_id: ${planAccount.account_id}`
      );

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

      return;
    }

    const paymentValue = Number(planAccount.value);
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
      value: planAccount.value,
      netValue: paymentResult.payment.netValue?.toString() || planAccount.value,
      pixTransaction: null,
      paymentStatusId,
      billingPeriodId: planAccount.billing_period_id,
      invoiceUrl: paymentResult.payment.invoiceUrl || null,
      recurringPayment: true,
      userCardId: defaultCard.user_card_id,
      installment: null,
    });

    if (paymentStatusId === EPaymentStatus.received) {
      const paymentDate =
        paymentResult.payment.paymentDate || new Date().toISOString();

      await this.planReleaseService.releasePlanForCreditCard({
        accountPaymentId,
        accountId: planAccount.account_id,
        planId: planAccount.plan_id,
        billingPeriodId: planAccount.billing_period_id,
        recurringPayment: true,
        value: planAccount.value,
        paymentDate,
        paymentStatusId,
      });
    }
  };
}
