import { injectable } from 'tsyringe';
import { PlanReleaseRepository } from '@core/repositories/plan/PlanRelease.repository';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';
import { AsaasPaymentWebhookRequest } from '@core/schema/payment/Webhook/request.schema';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { paymentAccountCentrifugo } from '@core/common/functions/centrifugoQueue';

@injectable()
export class PlanReleaseService {
  constructor(
    private readonly planReleaseRepository: PlanReleaseRepository,
    private readonly centrifugoService: CentrifugoService
  ) {}

  private mapAsaasStatusToPaymentStatus = (
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

  private isPaymentSuccessful = (status: string): boolean => {
    return (
      status === 'RECEIVED' ||
      status === 'CONFIRMED' ||
      status === 'RECEIVED_IN_CASH'
    );
  };

  private isPaymentStatusSuccessful = (paymentStatusId: string): boolean => {
    return (
      paymentStatusId === EPaymentStatus.received ||
      paymentStatusId === EPaymentStatus.confirmed ||
      paymentStatusId === EPaymentStatus.received_in_cash
    );
  };

  private calculateNextPaymentDate = (
    paymentDate: string,
    billingPeriodId: string | null,
    currentPlanId: string | null,
    newPlanId: string,
    currentNextPaymentDate: string | null
  ): string => {
    const paymentDateObj = new Date(paymentDate);
    let daysToAdd = 0;

    if (billingPeriodId === EBillingPeriod.monthly) {
      daysToAdd = 30;
    }

    if (billingPeriodId === EBillingPeriod.annual) {
      daysToAdd = 365;
    }

    if (currentPlanId === newPlanId && currentNextPaymentDate) {
      const currentNextDate = new Date(currentNextPaymentDate);
      currentNextDate.setDate(currentNextDate.getDate() + daysToAdd);
      return currentNextDate.toISOString();
    }

    paymentDateObj.setDate(paymentDateObj.getDate() + daysToAdd);
    return paymentDateObj.toISOString();
  };

  private checkIfPlanAlreadyReleased = async (
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

  private updatePaymentStatusOnly = async (
    accountPaymentId: string,
    paymentStatusId: string,
    paymentDate: string | null,
    pixTransaction: string | null,
    accountId: string,
    planId: string,
    recurringPayment: boolean,
    billingPeriodId: string | null,
    value: string,
    nextPaymentDate: string
  ): Promise<void> => {
    await this.planReleaseRepository.processPaymentAndReleasePlan({
      accountPaymentId,
      paymentStatusId,
      paymentDate,
      pixTransaction,
      accountId,
      planId,
      accountPaymentIdForPlan: accountPaymentId,
      recurringPayment,
      billingPeriodId,
      lastPaymentDate: paymentDate || new Date().toISOString(),
      nextPaymentDate,
      value,
      shouldReleasePlan: false,
    });
  };

  private releasePlanForPayment = async (
    accountPaymentId: string,
    paymentStatusId: string,
    paymentDate: string,
    pixTransaction: string | null,
    accountId: string,
    planId: string,
    recurringPayment: boolean,
    billingPeriodId: string | null,
    value: string
  ): Promise<void> => {
    const currentPlanAccount =
      await this.planReleaseRepository.findPlanAccountByAccountId(accountId);

    const nextPaymentDate = this.calculateNextPaymentDate(
      paymentDate,
      billingPeriodId,
      currentPlanAccount?.plan_id || null,
      planId,
      currentPlanAccount?.next_payment_date || null
    );

    await this.planReleaseRepository.processPaymentAndReleasePlan({
      accountPaymentId,
      paymentStatusId,
      paymentDate,
      pixTransaction,
      accountId,
      planId,
      accountPaymentIdForPlan: accountPaymentId,
      recurringPayment,
      billingPeriodId,
      lastPaymentDate: paymentDate,
      nextPaymentDate,
      value,
      shouldReleasePlan: true,
    });
  };

  private processSuccessfulPayment = async (
    accountPaymentData: NonNullable<
      Awaited<
        ReturnType<
          typeof this.planReleaseRepository.findAccountPaymentByBilling
        >
      >
    >,
    paymentStatusId: string,
    paymentDate: string,
    pixTransaction: string | null
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

      await this.updatePaymentStatusOnly(
        accountPaymentData.account_payment_id,
        paymentStatusId,
        paymentDate,
        pixTransaction,
        accountPaymentData.account_id,
        accountPaymentData.plan_id,
        accountPaymentData.recurring_payment,
        accountPaymentData.billing_period_id,
        accountPaymentData.value,
        existingPlanAccount?.next_payment_date || new Date().toISOString()
      );

      return;
    }

    await this.releasePlanForPayment(
      accountPaymentData.account_payment_id,
      paymentStatusId,
      paymentDate,
      pixTransaction,
      accountPaymentData.account_id,
      accountPaymentData.plan_id,
      accountPaymentData.recurring_payment,
      accountPaymentData.billing_period_id,
      accountPaymentData.value
    );
  };

  private processUnsuccessfulPayment = async (
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
    await this.updatePaymentStatusOnly(
      accountPaymentData.account_payment_id,
      paymentStatusId,
      paymentDate,
      pixTransaction,
      accountPaymentData.account_id,
      accountPaymentData.plan_id,
      accountPaymentData.recurring_payment,
      accountPaymentData.billing_period_id,
      accountPaymentData.value,
      new Date().toISOString()
    );
  };

  private checkIfCreditCardPlanAlreadyReleased = async (
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
    data: AsaasPaymentWebhookRequest
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
        data.payment.pixTransaction || null
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
      return;
    }

    await this.releasePlanForPayment(
      data.accountPaymentId,
      data.paymentStatusId,
      data.paymentDate,
      null,
      data.accountId,
      data.planId,
      data.recurringPayment,
      data.billingPeriodId,
      data.value
    );
  };

  private notifyPaymentStatusUpdate = async (
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
}
