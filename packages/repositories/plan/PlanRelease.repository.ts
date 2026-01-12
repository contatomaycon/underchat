import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import {
  accountPayment,
  planAccount,
  accountPaymentCrossSell,
  planCrossSellAccount,
  plan,
  nfse,
  account,
} from '@core/models';
import { randomUUID } from 'node:crypto';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class PlanReleaseRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
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
    const payment = await this.dbRo.query.accountPayment.findFirst({
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
    billing: string;
  } | null> => {
    const payment = await this.dbRo.query.accountPayment.findFirst({
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
        billing: true,
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
    billing_period_id: string | null;
    value: string | null;
    last_payment_date: string | null;
    cancellation_date: string | null;
  } | null> => {
    const planAcc = await this.dbRo.query.planAccount.findFirst({
      where: eq(planAccount.account_id, accountId),
      columns: {
        plan_account_id: true,
        plan_id: true,
        next_payment_date: true,
        account_payment_id: true,
        billing_period_id: true,
        value: true,
        last_payment_date: true,
        cancellation_date: true,
      },
      orderBy: (planAccount, { desc }) => [desc(planAccount.updated_at)],
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
    const planAcc = await this.dbRo.query.planAccount.findFirst({
      where: eq(planAccount.account_payment_id, accountPaymentId),
      columns: {
        plan_account_id: true,
        plan_id: true,
        next_payment_date: true,
      },
      orderBy: (planAccount, { desc }) => [desc(planAccount.updated_at)],
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
    billing_period_id: string | null;
  } | null> => {
    const planAcc = await tx.query.planAccount.findFirst({
      where: eq(planAccount.account_id, accountId),
      columns: {
        plan_account_id: true,
        plan_id: true,
        next_payment_date: true,
        billing_period_id: true,
      },
      orderBy: (planAccount, { desc }) => [desc(planAccount.updated_at)],
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

  private readonly updatePlanAccount = async (
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

  private readonly createPlanAccount = async (
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

  private readonly updateAccountStatusToActive = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    accountId: string
  ): Promise<void> => {
    await tx
      .update(account)
      .set({
        account_status_id: EAccountStatus.active,
        updated_at: currentTime(),
      })
      .where(eq(account.account_id, accountId));
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
    await this.dbRw.transaction(async (tx) => {
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

        await this.updateAccountStatusToActive(tx, data.accountId);

        await this.syncPlanCrossSellAccount(tx, {
          accountId: data.accountId,
          accountPaymentId: data.accountPaymentId,
        });
      }
    });
  };

  private readonly findAccountPaymentCrossSells = async (
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

  private readonly findPlanCrossSellAccountsByAccountId = async (
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

  private readonly syncPlanCrossSellAccount = async (
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

  private readonly categorizeCrossSellAccounts = (
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

  private readonly deleteAllCrossSellAccounts = async (
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

  private readonly restoreCrossSellAccounts = async (
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

  private readonly createCrossSellAccounts = async (
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

  private readonly deleteCrossSellAccounts = async (
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

  findPlanById = async (
    planId: string
  ): Promise<{ name: string; description: string | null } | null> => {
    const planData = await this.dbRo.query.plan.findFirst({
      where: eq(plan.plan_id, planId),
      columns: {
        name: true,
        description: true,
      },
    });

    return planData || null;
  };

  findPlanIsTestById = async (planId: string): Promise<boolean> => {
    const planData = await this.dbRo.query.plan.findFirst({
      where: eq(plan.plan_id, planId),
      columns: {
        is_test: true,
      },
    });

    return planData?.is_test || false;
  };

  private readonly createTestPlanAccountRecord = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    data: {
      accountId: string;
      planId: string;
      lastPaymentDate: string;
      nextPaymentDate: string;
    }
  ): Promise<void> => {
    const planAccountId = randomUUID();
    const planAccountData = {
      plan_account_id: planAccountId,
      account_id: data.accountId,
      plan_id: data.planId,
      account_payment_id: null,
      recurring_payment: false,
      billing_period_id: EBillingPeriod.monthly,
      last_payment_date: data.lastPaymentDate,
      next_payment_date: data.nextPaymentDate,
      cancellation_date: null,
      value: '0',
      created_at: data.lastPaymentDate,
      updated_at: data.lastPaymentDate,
    };

    await tx.insert(planAccount).values(planAccountData);
  };

  private readonly updateTestPlanAccountRecord = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    data: {
      planAccountId: string;
      planId: string;
      lastPaymentDate: string;
      nextPaymentDate: string;
    }
  ): Promise<void> => {
    const planAccountData = {
      plan_id: data.planId,
      account_payment_id: null,
      recurring_payment: false,
      billing_period_id: EBillingPeriod.monthly,
      last_payment_date: data.lastPaymentDate,
      next_payment_date: data.nextPaymentDate,
      cancellation_date: null,
      value: '0',
      updated_at: data.lastPaymentDate,
    };

    await tx
      .update(planAccount)
      .set(planAccountData)
      .where(eq(planAccount.plan_account_id, data.planAccountId));
  };

  createTestPlanAccount = async (data: {
    accountId: string;
    planId: string;
    daysTrial: number;
  }): Promise<void> => {
    await this.dbRw.transaction(async (tx) => {
      const now = new Date();
      const nextPaymentDate = new Date(now);
      nextPaymentDate.setDate(nextPaymentDate.getDate() + data.daysTrial);

      const nowIso = now.toISOString();
      const nextPaymentDateIso = nextPaymentDate.toISOString();

      const existingPlanAccount = await this.findPlanAccountByAccountIdTx(
        tx,
        data.accountId
      );

      if (existingPlanAccount) {
        await this.updateTestPlanAccountRecord(tx, {
          planAccountId: existingPlanAccount.plan_account_id,
          planId: data.planId,
          lastPaymentDate: nowIso,
          nextPaymentDate: nextPaymentDateIso,
        });

        await this.updateAccountStatusToActive(tx, data.accountId);

        return;
      }

      await this.createTestPlanAccountRecord(tx, {
        accountId: data.accountId,
        planId: data.planId,
        lastPaymentDate: nowIso,
        nextPaymentDate: nextPaymentDateIso,
      });

      await this.updateAccountStatusToActive(tx, data.accountId);
    });
  };

  findUserCustomerByAccountPaymentId = async (
    accountPaymentId: string
  ): Promise<{ user_customer: string } | null> => {
    const payment = await this.dbRo.query.accountPayment.findFirst({
      where: eq(accountPayment.account_payment_id, accountPaymentId),
      columns: {
        user_customer_id: true,
      },
      with: {
        auc: {
          columns: {
            user_customer: true,
          },
        },
      },
    });

    if (!payment?.auc) {
      return null;
    }

    return {
      user_customer: payment.auc.user_customer,
    };
  };

  findNfSeByAccountPaymentId = async (
    accountPaymentId: string
  ): Promise<{ account_payment_nfse_id: string } | null> => {
    const nfseRecord = await this.dbRo.query.accountPaymentNfSe.findFirst({
      where: eq(schema.accountPaymentNfSe.account_payment_id, accountPaymentId),
      columns: {
        account_payment_nfse_id: true,
      },
    });

    return nfseRecord || null;
  };

  findDefaultNfse = async (): Promise<{
    nfse_id: string;
    external_id: number | null;
    name: string;
    municipal_service_code: string | null;
    municipal_service_description_field: string | null;
    retain_iss: boolean;
    iss_value: string | null;
    cofins_value: string | null;
    csll_value: string | null;
    inss_value: string | null;
    ir_value: string | null;
    pis_value: string | null;
    deductions: string | null;
  } | null> => {
    const nfseRecord = await this.dbRo.query.nfse.findFirst({
      where: eq(nfse.default_product, true),
      columns: {
        nfse_id: true,
        external_id: true,
        name: true,
        municipal_service_code: true,
        municipal_service_description_field: true,
        retain_iss: true,
        iss_value: true,
        cofins_value: true,
        csll_value: true,
        inss_value: true,
        ir_value: true,
        pis_value: true,
        deductions: true,
      },
    });

    return nfseRecord || null;
  };

  findAccountGenerateInvoiceById = async (
    accountId: string
  ): Promise<boolean | null> => {
    const accountData = await this.dbRo.query.account.findFirst({
      where: eq(account.account_id, accountId),
      columns: {
        generate_invoice: true,
      },
    });

    return accountData?.generate_invoice ?? null;
  };
}
