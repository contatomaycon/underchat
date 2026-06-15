import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
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
import { EAccountPaymentReleaseStatus } from '@core/common/enums/EAccountPaymentReleaseStatus';

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
    is_addon_only: boolean;
    value: string;
    payment_date: string | null;
    payment_status_id: string;
    release_status: string | null;
  } | null> => {
    const payment = await this.dbRw.query.accountPayment.findFirst({
      where: eq(accountPayment.billing, billing),
      columns: {
        account_payment_id: true,
        account_id: true,
        plan_id: true,
        billing_period_id: true,
        recurring_payment: true,
        is_addon_only: true,
        value: true,
        payment_date: true,
        payment_status_id: true,
        release_status: true,
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
    is_addon_only: boolean;
    value: string;
    payment_date: string | null;
    payment_status_id: string;
    billing: string;
    release_status: string | null;
  } | null> => {
    const payment = await this.dbRw.query.accountPayment.findFirst({
      where: eq(accountPayment.account_payment_id, accountPaymentId),
      columns: {
        account_payment_id: true,
        account_id: true,
        plan_id: true,
        billing_period_id: true,
        recurring_payment: true,
        is_addon_only: true,
        value: true,
        payment_date: true,
        payment_status_id: true,
        billing: true,
        release_status: true,
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
    pixTransaction: string | null | undefined,
    releaseUpdate?: {
      releaseStatus?: string | null;
      releaseProcessedAt?: string | null;
      releaseLastError?: string | null;
    }
  ): Promise<void> => {
    const updateData: {
      payment_status_id: string;
      payment_date: string | null;
      pix_transaction?: string | null;
      release_status?: string | null;
      release_processed_at?: string | null;
      release_last_error?: string | null;
      updated_at: string;
    } = {
      payment_status_id: paymentStatusId,
      payment_date: paymentDate,
      updated_at: new Date().toISOString(),
    };

    if (pixTransaction !== undefined) {
      updateData.pix_transaction = pixTransaction;
    }

    if (releaseUpdate?.releaseStatus !== undefined) {
      updateData.release_status = releaseUpdate.releaseStatus;
    }

    if (releaseUpdate?.releaseProcessedAt !== undefined) {
      updateData.release_processed_at = releaseUpdate.releaseProcessedAt;
    }

    if (releaseUpdate?.releaseLastError !== undefined) {
      updateData.release_last_error = releaseUpdate.releaseLastError;
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
    const planAcc = await this.dbRw.query.planAccount.findFirst({
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
    const planAcc = await this.dbRw.query.planAccount.findFirst({
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
    replaceExistingAddons?: boolean;
    isAddonOnly?: boolean;
    releaseStatus?: string | null;
    releaseProcessedAt?: string | null;
    releaseLastError?: string | null;
  }): Promise<void> => {
    await this.dbRw.transaction(async (tx) => {
      const currentPayment = await tx.query.accountPayment.findFirst({
        where: eq(accountPayment.account_payment_id, data.accountPaymentId),
        columns: {
          release_status: true,
        },
      });

      const isReleaseAlreadyProcessed =
        currentPayment?.release_status ===
        EAccountPaymentReleaseStatus.processed;

      await this.updateAccountPaymentStatus(
        tx,
        data.accountPaymentId,
        data.paymentStatusId,
        data.paymentDate,
        data.pixTransaction,
        {
          releaseStatus: data.releaseStatus,
          releaseProcessedAt: data.releaseProcessedAt,
          releaseLastError: data.releaseLastError,
        }
      );

      if (data.shouldReleasePlan && !isReleaseAlreadyProcessed) {
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

        if (data.replaceExistingAddons === false) {
          await this.appendPlanCrossSellAccount(tx, {
            accountId: data.accountId,
            accountPaymentId: data.accountPaymentId,
          });
        } else {
          await this.replacePlanCrossSellAccount(tx, {
            accountId: data.accountId,
            accountPaymentId: data.accountPaymentId,
          });
        }

        return;
      }

      if (data.isAddonOnly && !isReleaseAlreadyProcessed) {
        await this.appendPlanCrossSellAccount(tx, {
          accountId: data.accountId,
          accountPaymentId: data.accountPaymentId,
        });
      }
    });
  };

  markAccountPaymentReleaseFailed = async (
    accountPaymentId: string,
    errorMessage: string
  ): Promise<void> => {
    await this.dbRw
      .update(accountPayment)
      .set({
        release_status: EAccountPaymentReleaseStatus.failed,
        release_processed_at: null,
        release_last_error: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(accountPayment.account_payment_id, accountPaymentId),
          or(
            isNull(accountPayment.release_status),
            ne(
              accountPayment.release_status,
              EAccountPaymentReleaseStatus.processed
            )
          )
        )
      );
  };

  markAccountPaymentReleaseProcessed = async (
    accountPaymentId: string,
    processedAt?: string | null
  ): Promise<void> => {
    await this.dbRw
      .update(accountPayment)
      .set({
        release_status: EAccountPaymentReleaseStatus.processed,
        release_processed_at: processedAt || new Date().toISOString(),
        release_last_error: null,
        updated_at: new Date().toISOString(),
      })
      .where(eq(accountPayment.account_payment_id, accountPaymentId));
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

  private readonly findActivePlanCrossSellAccountsByAccountId = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    accountId: string
  ): Promise<
    Array<{
      plan_cross_sell_account_id: string;
    }>
  > => {
    const accounts = await tx.query.planCrossSellAccount.findMany({
      where: and(
        eq(planCrossSellAccount.account_id, accountId),
        isNull(planCrossSellAccount.deleted_at)
      ),
      columns: {
        plan_cross_sell_account_id: true,
      },
    });

    return accounts;
  };

  private readonly softDeletePlanCrossSellAccounts = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    accounts: Array<{ plan_cross_sell_account_id: string }>
  ): Promise<void> => {
    if (accounts.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    const updatePromises = accounts.map((existing) =>
      tx
        .update(planCrossSellAccount)
        .set({
          deleted_at: now,
          updated_at: now,
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

  private readonly createPlanCrossSellAccounts = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    accountId: string,
    paymentCrossSells: Array<{ plan_cross_sell_id: string }>
  ): Promise<void> => {
    if (paymentCrossSells.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    const insertValues = paymentCrossSells.map((crossSell) => ({
      plan_cross_sell_account_id: randomUUID(),
      plan_cross_sell_id: crossSell.plan_cross_sell_id,
      account_id: accountId,
      created_at: now,
      updated_at: now,
      cancellation_date: null,
      deleted_at: null,
    }));

    await tx.insert(planCrossSellAccount).values(insertValues);
  };

  private readonly replacePlanCrossSellAccount = async (
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
      this.findActivePlanCrossSellAccountsByAccountId(tx, data.accountId),
    ]);

    await this.softDeletePlanCrossSellAccounts(tx, existingCrossSellAccounts);

    if (paymentCrossSells.length === 0) {
      return;
    }

    await this.createPlanCrossSellAccounts(
      tx,
      data.accountId,
      paymentCrossSells
    );
  };

  private readonly appendPlanCrossSellAccount = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    data: {
      accountId: string;
      accountPaymentId: string;
    }
  ): Promise<void> => {
    const paymentCrossSells = await this.findAccountPaymentCrossSells(
      tx,
      data.accountPaymentId
    );

    if (paymentCrossSells.length === 0) {
      return;
    }

    await this.createPlanCrossSellAccounts(
      tx,
      data.accountId,
      paymentCrossSells
    );
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
  ): Promise<{ user_customer: string; user_id: string } | null> => {
    const payment = await this.dbRw.query.accountPayment.findFirst({
      where: eq(accountPayment.account_payment_id, accountPaymentId),
      columns: {
        user_customer_id: true,
      },
      with: {
        auc: {
          columns: {
            user_customer: true,
            user_id: true,
          },
        },
      },
    });

    if (!payment?.auc) {
      return null;
    }

    return {
      user_customer: payment.auc.user_customer,
      user_id: payment.auc.user_id,
    };
  };

  findNfSeByAccountPaymentId = async (
    accountPaymentId: string
  ): Promise<{ account_payment_nfse_id: string } | null> => {
    const nfseRecord = await this.dbRw.query.accountPaymentNfSe.findFirst({
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
    integration_enabled: boolean;
    integration_base_url: string | null;
    integration_uf: string | null;
    integration_tenant: string | null;
    integration_username: string | null;
    integration_password_encrypted: string | null;
    integration_municipality_code: string | null;
    integration_rps_series: string | null;
    integration_prestador_document: string | null;
    integration_prestador_municipal_inscription: string | null;
    certificate_bucket: string | null;
    certificate_key: string | null;
    certificate_file_name: string | null;
    certificate_password_encrypted: string | null;
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
        integration_enabled: true,
        integration_base_url: true,
        integration_uf: true,
        integration_tenant: true,
        integration_username: true,
        integration_password_encrypted: true,
        integration_municipality_code: true,
        integration_rps_series: true,
        integration_prestador_document: true,
        integration_prestador_municipal_inscription: true,
        certificate_bucket: true,
        certificate_key: true,
        certificate_file_name: true,
        certificate_password_encrypted: true,
      },
    });

    return nfseRecord || null;
  };

  findAccountGenerateInvoiceById = async (
    accountId: string
  ): Promise<boolean | null> => {
    const accountData = await this.dbRw.query.account.findFirst({
      where: eq(account.account_id, accountId),
      columns: {
        generate_invoice: true,
      },
    });

    if (!accountData) {
      return null;
    }

    return accountData.generate_invoice ?? true;
  };
}
