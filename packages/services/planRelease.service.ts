import { injectable, inject } from 'tsyringe';
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
    } else if (billingPeriodId === EBillingPeriod.annual) {
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

    const isCurrentStatusSuccessful = this.isPaymentStatusSuccessful(
      accountPaymentData.payment_status_id
    );

    const isSuccessful = this.isPaymentSuccessful(data.payment.status);
    const paymentDate = isSuccessful
      ? data.payment.paymentDate ||
        data.payment.confirmedDate ||
        new Date().toISOString()
      : null;

    if (isSuccessful && !isCurrentStatusSuccessful) {
      const currentPlanAccount =
        await this.planReleaseRepository.findPlanAccountByAccountId(
          accountPaymentData.account_id
        );

      const nextPaymentDate = this.calculateNextPaymentDate(
        paymentDate!,
        accountPaymentData.billing_period_id,
        currentPlanAccount?.plan_id || null,
        accountPaymentData.plan_id,
        currentPlanAccount?.next_payment_date || null
      );

      await this.planReleaseRepository.processPaymentAndReleasePlan({
        accountPaymentId: accountPaymentData.account_payment_id,
        paymentStatusId,
        paymentDate,
        pixTransaction: data.payment.pixTransaction || null,
        accountId: accountPaymentData.account_id,
        planId: accountPaymentData.plan_id,
        accountPaymentIdForPlan: accountPaymentData.account_payment_id,
        recurringPayment: accountPaymentData.recurring_payment,
        billingPeriodId: accountPaymentData.billing_period_id,
        lastPaymentDate: paymentDate!,
        nextPaymentDate,
        value: accountPaymentData.value,
        shouldReleasePlan: true,
      });
    } else {
      await this.planReleaseRepository.processPaymentAndReleasePlan({
        accountPaymentId: accountPaymentData.account_payment_id,
        paymentStatusId,
        paymentDate: null,
        pixTransaction: data.payment.pixTransaction || null,
        accountId: accountPaymentData.account_id,
        planId: accountPaymentData.plan_id,
        accountPaymentIdForPlan: accountPaymentData.account_payment_id,
        recurringPayment: accountPaymentData.recurring_payment,
        billingPeriodId: accountPaymentData.billing_period_id,
        lastPaymentDate: paymentDate || new Date().toISOString(),
        nextPaymentDate: new Date().toISOString(),
        value: accountPaymentData.value,
        shouldReleasePlan: false,
      });
    }

    await this.notifyPaymentStatusUpdate(
      accountPaymentData.account_id,
      data.payment.id,
      data.payment.status,
      paymentDate
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
