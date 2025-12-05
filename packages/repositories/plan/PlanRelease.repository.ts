import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { accountPayment, planAccount } from '@core/models';
import { randomUUID } from 'crypto';

@injectable()
export class PlanReleaseRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  findAccountPaymentByBilling = async (
    billing: string
  ): Promise<{
    account_payment_id: string;
    account_id: string;
    plan_id: string;
    billing_period_id: string | null;
    recurring_payment: boolean;
    value: string;
    payment_date: string | null;
    payment_status_id: string;
  } | null> => {
    const payment = await this.db.query.accountPayment.findFirst({
      where: eq(accountPayment.billing, billing),
      columns: {
        account_payment_id: true,
        account_id: true,
        plan_id: true,
        billing_period_id: true,
        recurring_payment: true,
        value: true,
        payment_date: true,
        payment_status_id: true,
      },
    });

    return payment || null;
  };

  updateAccountPaymentStatus = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    accountPaymentId: string,
    paymentStatusId: string,
    paymentDate: string | null,
    pixTransaction: string | null | undefined
  ): Promise<void> => {
    const updateData: {
      payment_status_id: string;
      payment_date: string | null;
      pix_transaction?: string | null;
      updated_at: string;
    } = {
      payment_status_id: paymentStatusId,
      payment_date: paymentDate,
      updated_at: new Date().toISOString(),
    };

    if (pixTransaction !== undefined) {
      updateData.pix_transaction = pixTransaction;
    }

    await tx
      .update(accountPayment)
      .set(updateData)
      .where(eq(accountPayment.account_payment_id, accountPaymentId));
  };

  findPlanAccountByAccountId = async (
    accountId: string
  ): Promise<{
    plan_account_id: string;
    plan_id: string;
    next_payment_date: string | null;
  } | null> => {
    const planAcc = await this.db.query.planAccount.findFirst({
      where: eq(planAccount.account_id, accountId),
      columns: {
        plan_account_id: true,
        plan_id: true,
        next_payment_date: true,
      },
    });

    return planAcc || null;
  };

  findPlanAccountByAccountIdTx = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    accountId: string
  ): Promise<{
    plan_account_id: string;
    plan_id: string;
    next_payment_date: string | null;
  } | null> => {
    const planAcc = await tx.query.planAccount.findFirst({
      where: eq(planAccount.account_id, accountId),
      columns: {
        plan_account_id: true,
        plan_id: true,
        next_payment_date: true,
      },
    });

    return planAcc || null;
  };

  upsertPlanAccount = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    data: {
      accountId: string;
      planId: string;
      accountPaymentId: string;
      recurringPayment: boolean;
      billingPeriodId: string | null;
      lastPaymentDate: string;
      nextPaymentDate: string;
      value: string;
    }
  ): Promise<void> => {
    const existingPlanAccount = await this.findPlanAccountByAccountIdTx(
      tx,
      data.accountId
    );

    const planAccountData = {
      account_id: data.accountId,
      plan_id: data.planId,
      account_payment_id: data.accountPaymentId,
      recurring_payment: data.recurringPayment,
      billing_period_id: data.billingPeriodId,
      last_payment_date: data.lastPaymentDate,
      next_payment_date: data.nextPaymentDate,
      cancellation_date: null,
      value: data.value,
      updated_at: new Date().toISOString(),
    };

    if (existingPlanAccount) {
      await tx
        .update(planAccount)
        .set(planAccountData)
        .where(
          eq(planAccount.plan_account_id, existingPlanAccount.plan_account_id)
        );
    } else {
      const planAccountId = randomUUID();
      await tx.insert(planAccount).values({
        plan_account_id: planAccountId,
        ...planAccountData,
        created_at: new Date().toISOString(),
      });
    }
  };

  processPaymentAndReleasePlan = async (data: {
    accountPaymentId: string;
    paymentStatusId: string;
    paymentDate: string | null;
    pixTransaction: string | null | undefined;
    accountId: string;
    planId: string;
    accountPaymentIdForPlan: string;
    recurringPayment: boolean;
    billingPeriodId: string | null;
    lastPaymentDate: string;
    nextPaymentDate: string;
    value: string;
    shouldReleasePlan: boolean;
  }): Promise<void> => {
    await this.db.transaction(async (tx) => {
      await this.updateAccountPaymentStatus(
        tx,
        data.accountPaymentId,
        data.paymentStatusId,
        data.paymentDate,
        data.pixTransaction
      );

      if (data.shouldReleasePlan) {
        await this.upsertPlanAccount(tx, {
          accountId: data.accountId,
          planId: data.planId,
          accountPaymentId: data.accountPaymentIdForPlan,
          recurringPayment: data.recurringPayment,
          billingPeriodId: data.billingPeriodId,
          lastPaymentDate: data.lastPaymentDate,
          nextPaymentDate: data.nextPaymentDate,
          value: data.value,
        });
      }
    });
  };
}
