import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AsaasService } from '@core/services/asaas';
import { currentTime } from '@core/common/functions/currentTime';
import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { accountPaymentNfSe, planAccount } from '@core/models';
import { eq, and, isNull } from 'drizzle-orm';
import {
  IPlanAccountCancellationData,
  IPlanAccountCancellationResult,
} from '@core/common/interfaces/IPlanAccountCancellation';
import { PlanAccountCancellerRepository } from '@core/repositories/accountSettings/PlanAccountCanceller.repository';

@injectable()
export class PlanAccountCancellationService {
  constructor(
    private readonly asaasService: AsaasService,
    private readonly planAccountCancellerRepository: PlanAccountCancellerRepository,
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private isWithin7DaysPeriod(lastPaymentDate: string | null): boolean {
    if (!lastPaymentDate) return false;

    const lastPayment = new Date(lastPaymentDate);
    const now = new Date();
    const daysDiff = Math.floor(
      (now.getTime() - lastPayment.getTime()) / (1000 * 60 * 60 * 24)
    );

    return daysDiff <= 7;
  }

  private async cancelPaymentInAsaas(paymentId: string): Promise<boolean> {
    try {
      const result = await this.asaasService.refundPayment(paymentId);
      return result !== null;
    } catch (error) {
      console.error('Erro ao estornar pagamento no Asaas:', error);
      return false;
    }
  }

  private async cancelSubscriptionInAsaas(
    subscriptionId: string
  ): Promise<boolean> {
    try {
      const result = await this.asaasService.deleteSubscription(subscriptionId);
      return result !== null;
    } catch (error) {
      console.error('Erro ao cancelar subscription no Asaas:', error);
      return false;
    }
  }

  private async cancelInvoiceInAsaas(invoiceId: string): Promise<boolean> {
    try {
      const result = await this.asaasService.cancelInvoice(invoiceId);
      return result !== null;
    } catch (error) {
      console.error('Erro ao cancelar invoice no Asaas:', error);
      return false;
    }
  }

  private async findInvoiceIdByAccountPaymentId(
    accountPaymentId: string
  ): Promise<string | null> {
    try {
      const nfseData = await this.db.query.accountPaymentNfSe.findFirst({
        where: eq(accountPaymentNfSe.account_payment_id, accountPaymentId),
        columns: {
          reference: true,
        },
      });

      return nfseData?.reference || null;
    } catch (error) {
      console.error('Erro ao buscar invoice ID por account_payment_id:', error);
      return null;
    }
  }

  private async findSubscriptionIdByPaymentId(
    paymentId: string
  ): Promise<string | null> {
    try {
      const payment = await this.asaasService.getPayment(paymentId);
      return payment?.subscription || null;
    } catch (error) {
      console.error('Erro ao buscar subscription ID por payment ID:', error);
      return null;
    }
  }

  private async executeAsaasCancellationActions(
    data: IPlanAccountCancellationData
  ): Promise<IPlanAccountCancellationResult['asaasActions']> {
    const result = {
      paymentRefunded: false,
      subscriptionCancelled: false,
      invoiceCancelled: false,
    };

    if (!data.billing) {
      return result;
    }

    try {
      const subscriptionId = await this.findSubscriptionIdByPaymentId(
        data.billing
      );

      if (subscriptionId) {
        result.subscriptionCancelled =
          await this.cancelSubscriptionInAsaas(subscriptionId);
      }

      result.paymentRefunded = await this.cancelPaymentInAsaas(data.billing);

      if (data.account_payment_id) {
        const invoiceId = await this.findInvoiceIdByAccountPaymentId(
          data.account_payment_id
        );

        if (invoiceId) {
          result.invoiceCancelled = await this.cancelInvoiceInAsaas(invoiceId);
        }
      }
    } catch (error) {
      console.error('Erro ao executar ações de cancelamento no Asaas:', error);
    }

    return result;
  }

  private async executeCancellation(
    data: IPlanAccountCancellationData
  ): Promise<IPlanAccountCancellationResult> {
    const isWithin7Days = this.isWithin7DaysPeriod(data.last_payment_date);
    const cancellationDate = currentTime();
    const shouldCancelNextPayment = isWithin7Days;

    let asaasActions = {
      paymentRefunded: false,
      subscriptionCancelled: false,
      invoiceCancelled: false,
    };

    if (isWithin7Days) {
      asaasActions = await this.executeAsaasCancellationActions(data);
    }

    return {
      isWithin7Days,
      cancellationDate,
      shouldCancelNextPayment,
      asaasActions,
    };
  }

  private async updatePlanAccountInDatabase(
    planAccountId: string,
    cancellationDate: string,
    shouldCancelNextPayment: boolean
  ): Promise<boolean> {
    const updateData: {
      cancellation_date: string;
      next_payment_date?: null;
      updated_at: string;
    } = {
      cancellation_date: cancellationDate,
      updated_at: currentTime(),
    };

    if (shouldCancelNextPayment) {
      updateData.next_payment_date = null;
    }

    const result = await this.db
      .update(planAccount)
      .set(updateData)
      .where(
        and(
          eq(planAccount.plan_account_id, planAccountId),
          isNull(planAccount.cancellation_date)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  }

  private buildCancellationMessage(
    t: TFunction<'translation', undefined>,
    result: IPlanAccountCancellationResult
  ): string {
    if (!result.isWithin7Days) {
      return t('subscription_cancelled_successfully');
    }

    const actions = result.asaasActions;
    const actionMessages: string[] = [];

    if (actions.paymentRefunded) {
      actionMessages.push(t('payment_refunded'));
    }
    if (actions.subscriptionCancelled) {
      actionMessages.push(t('subscription_cancelled'));
    }
    if (actions.invoiceCancelled) {
      actionMessages.push(t('invoice_cancelled'));
    }

    if (actionMessages.length > 0) {
      return t('subscription_cancelled_and_actions_successfully', {
        actions: actionMessages.join(', '),
      });
    }

    return t('subscription_cancelled_successfully');
  }

  async cancelPlanAccount(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<string> {
    const planAccountData =
      await this.planAccountCancellerRepository.findPlanAccountWithPayment(
        accountId
      );

    if (!planAccountData?.plan_account_id) {
      throw new Error(t('plan_not_found_or_already_cancelled'));
    }

    return this.cancelPlanAccountByPlanAccountId(
      t,
      planAccountData.plan_account_id
    );
  }

  private async cancelPlanAccountByPlanAccountId(
    t: TFunction<'translation', undefined>,
    planAccountId: string
  ): Promise<string> {
    const planAccountData =
      await this.planAccountCancellerRepository.findPlanAccountById(
        planAccountId
      );

    if (!planAccountData) {
      throw new Error(t('plan_not_found_or_already_cancelled'));
    }

    if (!planAccountData.last_payment_date) {
      throw new Error(t('last_payment_date_not_found'));
    }

    const cancellationResult = await this.executeCancellation({
      account_payment_id: planAccountData.account_payment_id,
      billing: planAccountData.apy?.billing || null,
      last_payment_date: planAccountData.last_payment_date,
    });

    const success = await this.updatePlanAccountInDatabase(
      planAccountId,
      cancellationResult.cancellationDate,
      cancellationResult.shouldCancelNextPayment
    );

    if (!success) {
      throw new Error(t('subscription_cancellation_error'));
    }

    return this.buildCancellationMessage(t, cancellationResult);
  }
}
