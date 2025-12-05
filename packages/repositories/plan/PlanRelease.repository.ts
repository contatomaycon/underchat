import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import {
  accountPayment,
  planAccount,
  accountPaymentCrossSell,
  planCrossSellAccount,
} from '@core/models';
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

  findAccountPaymentById = async (
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
  } | null> => {
    const payment = await this.db.query.accountPayment.findFirst({
      where: eq(accountPayment.account_payment_id, accountPaymentId),
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
    account_payment_id: string | null;
  } | null> => {
    const planAcc = await this.db.query.planAccount.findFirst({
      where: eq(planAccount.account_id, accountId),
      columns: {
        plan_account_id: true,
        plan_id: true,
        next_payment_date: true,
        account_payment_id: true,
      },
    });

    return planAcc || null;
  };

  findPlanAccountByAccountPaymentId = async (
    accountPaymentId: string
  ): Promise<{
    plan_account_id: string;
    plan_id: string;
    next_payment_date: string | null;
  } | null> => {
    const planAcc = await this.db.query.planAccount.findFirst({
      where: eq(planAccount.account_payment_id, accountPaymentId),
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

    if (existingPlanAccount) {
      await this.updatePlanAccount(tx, existingPlanAccount.plan_account_id, {
        accountId: data.accountId,
        planId: data.planId,
        accountPaymentId: data.accountPaymentId,
        recurringPayment: data.recurringPayment,
        billingPeriodId: data.billingPeriodId,
        lastPaymentDate: data.lastPaymentDate,
        nextPaymentDate: data.nextPaymentDate,
        value: data.value,
      });
      return;
    }

    await this.createPlanAccount(tx, {
      accountId: data.accountId,
      planId: data.planId,
      accountPaymentId: data.accountPaymentId,
      recurringPayment: data.recurringPayment,
      billingPeriodId: data.billingPeriodId,
      lastPaymentDate: data.lastPaymentDate,
      nextPaymentDate: data.nextPaymentDate,
      value: data.value,
    });
  };

  private updatePlanAccount = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    planAccountId: string,
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

    await tx
      .update(planAccount)
      .set(planAccountData)
      .where(eq(planAccount.plan_account_id, planAccountId));
  };

  private createPlanAccount = async (
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
    const planAccountId = randomUUID();
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await tx.insert(planAccount).values({
      plan_account_id: planAccountId,
      ...planAccountData,
    });
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

        await this.syncPlanCrossSellAccount(tx, {
          accountId: data.accountId,
          accountPaymentId: data.accountPaymentId,
        });
      }
    });
  };

  private findAccountPaymentCrossSells = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    accountPaymentId: string
  ): Promise<Array<{ plan_cross_sell_id: string }>> => {
    const crossSells = await tx.query.accountPaymentCrossSell.findMany({
      where: eq(accountPaymentCrossSell.account_payment_id, accountPaymentId),
      columns: {
        plan_cross_sell_id: true,
      },
    });

    return crossSells;
  };

  private findPlanCrossSellAccountsByAccountId = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    accountId: string
  ): Promise<
    Array<{
      plan_cross_sell_account_id: string;
      plan_cross_sell_id: string;
      deleted_at: string | null;
    }>
  > => {
    const accounts = await tx.query.planCrossSellAccount.findMany({
      where: eq(planCrossSellAccount.account_id, accountId),
      columns: {
        plan_cross_sell_account_id: true,
        plan_cross_sell_id: true,
        deleted_at: true,
      },
    });

    return accounts;
  };

  private syncPlanCrossSellAccount = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    data: {
      accountId: string;
      accountPaymentId: string;
    }
  ): Promise<void> => {
    const [paymentCrossSells, existingCrossSellAccounts] = await Promise.all([
      this.findAccountPaymentCrossSells(tx, data.accountPaymentId),
      this.findPlanCrossSellAccountsByAccountId(tx, data.accountId),
    ]);

    const paymentCrossSellIdsSet = new Set(
      paymentCrossSells.map((cs) => cs.plan_cross_sell_id)
    );
    const paymentCrossSellIds = Array.from(paymentCrossSellIdsSet);

    if (paymentCrossSellIds.length === 0) {
      await this.deleteAllCrossSellAccounts(tx, existingCrossSellAccounts);
      return;
    }

    const { toRestore, toCreate, toDelete } = this.categorizeCrossSellAccounts(
      paymentCrossSellIds,
      existingCrossSellAccounts
    );

    await Promise.all([
      this.restoreCrossSellAccounts(tx, toRestore),
      this.createCrossSellAccounts(tx, toCreate, data.accountId),
      this.deleteCrossSellAccounts(tx, toDelete),
    ]);
  };

  private categorizeCrossSellAccounts = (
    paymentCrossSellIds: string[],
    existingCrossSellAccounts: Array<{
      plan_cross_sell_account_id: string;
      plan_cross_sell_id: string;
      deleted_at: string | null;
    }>
  ): {
    toRestore: Array<{
      plan_cross_sell_account_id: string;
      plan_cross_sell_id: string;
    }>;
    toCreate: string[];
    toDelete: Array<{ plan_cross_sell_account_id: string }>;
  } => {
    const existingMap = new Map(
      existingCrossSellAccounts.map((eca) => [eca.plan_cross_sell_id, eca])
    );

    const toRestore: Array<{
      plan_cross_sell_account_id: string;
      plan_cross_sell_id: string;
    }> = [];
    const toCreate: string[] = [];
    const paymentCrossSellIdsSet = new Set(paymentCrossSellIds);

    for (const paymentCrossSellId of paymentCrossSellIds) {
      const existingAccount = existingMap.get(paymentCrossSellId);

      if (existingAccount) {
        if (existingAccount.deleted_at) {
          toRestore.push({
            plan_cross_sell_account_id:
              existingAccount.plan_cross_sell_account_id,
            plan_cross_sell_id: paymentCrossSellId,
          });
        }
        continue;
      }

      toCreate.push(paymentCrossSellId);
    }

    const toDelete = existingCrossSellAccounts
      .filter((eca) => !paymentCrossSellIdsSet.has(eca.plan_cross_sell_id))
      .map((eca) => ({
        plan_cross_sell_account_id: eca.plan_cross_sell_account_id,
      }));

    return { toRestore, toCreate, toDelete };
  };

  private deleteAllCrossSellAccounts = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    existingCrossSellAccounts: Array<{
      plan_cross_sell_account_id: string;
      plan_cross_sell_id: string;
      deleted_at: string | null;
    }>
  ): Promise<void> => {
    if (existingCrossSellAccounts.length === 0) {
      return;
    }

    const updatePromises = existingCrossSellAccounts.map((existing) =>
      tx
        .update(planCrossSellAccount)
        .set({
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .where(
          eq(
            planCrossSellAccount.plan_cross_sell_account_id,
            existing.plan_cross_sell_account_id
          )
        )
    );

    await Promise.all(updatePromises);
  };

  private restoreCrossSellAccounts = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    toRestore: Array<{
      plan_cross_sell_account_id: string;
      plan_cross_sell_id: string;
    }>
  ): Promise<void> => {
    if (toRestore.length === 0) {
      return;
    }

    const restorePromises = toRestore.map((item) =>
      tx
        .update(planCrossSellAccount)
        .set({
          deleted_at: null,
          updated_at: new Date().toISOString(),
        })
        .where(
          eq(
            planCrossSellAccount.plan_cross_sell_account_id,
            item.plan_cross_sell_account_id
          )
        )
    );

    await Promise.all(restorePromises);
  };

  private createCrossSellAccounts = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    toCreate: string[],
    accountId: string
  ): Promise<void> => {
    if (toCreate.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    const insertValues = toCreate.map((planCrossSellId) => ({
      plan_cross_sell_account_id: randomUUID(),
      plan_cross_sell_id: planCrossSellId,
      account_id: accountId,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }));

    await tx.insert(planCrossSellAccount).values(insertValues);
  };

  private deleteCrossSellAccounts = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    toDelete: Array<{ plan_cross_sell_account_id: string }>
  ): Promise<void> => {
    if (toDelete.length === 0) {
      return;
    }

    const deletePromises = toDelete.map((item) =>
      tx
        .update(planCrossSellAccount)
        .set({
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .where(
          eq(
            planCrossSellAccount.plan_cross_sell_account_id,
            item.plan_cross_sell_account_id
          )
        )
    );

    await Promise.all(deletePromises);
  };
}
