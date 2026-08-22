import * as schema from '@core/models';
import { planAccount, worker, accountPaymentNfSe, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { IPlanAccountWithCancellation } from '@core/common/interfaces/IPlanAccountWithCancellation';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class PlanAccountCancellerRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  findPlanAccountWithPayment = async (accountId: string) => {
    const currentPlan = await this.dbRw.query.planAccount.findFirst({
      where: eq(planAccount.account_id, accountId),
      columns: {
        plan_account_id: true,
        account_payment_id: true,
        last_payment_date: true,
        next_payment_date: true,
        cancellation_date: true,
        created_at: true,
      },
      with: {
        apy: {
          columns: {
            account_payment_id: true,
            billing: true,
            recurring_payment: true,
          },
        },
      },
      orderBy: (currentPlan) => [
        sql`${currentPlan.updated_at} DESC NULLS LAST`,
        sql`${currentPlan.created_at} DESC NULLS LAST`,
        sql`${currentPlan.plan_account_id} DESC`,
      ],
    });

    return currentPlan?.cancellation_date ? undefined : currentPlan;
  };

  findPlanAccountWithCancellation = async (
    accountId: string
  ): Promise<IPlanAccountWithCancellation | null> => {
    const result = await this.dbRw
      .select({
        plan_account_id: planAccount.plan_account_id,
        cancellation_date: planAccount.cancellation_date,
        next_payment_date: planAccount.next_payment_date,
        account_status_id: account.account_status_id,
      })
      .from(planAccount)
      .innerJoin(account, eq(planAccount.account_id, account.account_id))
      .where(eq(planAccount.account_id, accountId))
      .orderBy(
        sql`${planAccount.updated_at} DESC NULLS LAST`,
        sql`${planAccount.created_at} DESC NULLS LAST`,
        sql`${planAccount.plan_account_id} DESC`
      )
      .limit(1)
      .execute();

    if (result.length === 0) {
      return null;
    }

    return result[0];
  };

  findPlanAccountById = async (planAccountId: string) => {
    return this.dbRw.query.planAccount.findFirst({
      where: and(
        eq(planAccount.plan_account_id, planAccountId),
        isNull(planAccount.cancellation_date)
      ),
      columns: {
        plan_account_id: true,
        account_id: true,
        account_payment_id: true,
        last_payment_date: true,
        next_payment_date: true,
        cancellation_date: true,
        created_at: true,
      },
      with: {
        apy: {
          columns: {
            account_payment_id: true,
            billing: true,
            recurring_payment: true,
          },
        },
      },
    });
  };

  findWorkersByAccountId = async (accountId: string): Promise<string[]> => {
    const result = await this.dbRw
      .select({
        worker_id: worker.worker_id,
      })
      .from(worker)
      .where(and(eq(worker.account_id, accountId), isNull(worker.deleted_at)))
      .execute();

    return result.map((w) => w.worker_id);
  };

  findInvoiceIdByAccountPaymentId = async (
    accountPaymentId: string
  ): Promise<string | null> => {
    const nfseData = await this.dbRo.query.accountPaymentNfSe.findFirst({
      where: eq(accountPaymentNfSe.account_payment_id, accountPaymentId),
      columns: {
        reference: true,
      },
    });

    return nfseData?.reference || null;
  };

  updatePlanAccountById = async (
    planAccountId: string,
    cancellationDate: string,
    shouldCancelNextPayment: boolean
  ): Promise<boolean> => {
    const updateData: {
      cancellation_date: string;
      next_payment_date?: null;
      recurring_payment: boolean;
    } = {
      cancellation_date: cancellationDate,
      recurring_payment: false,
    };

    if (shouldCancelNextPayment) {
      updateData.next_payment_date = null;
    }

    return this.dbRw.transaction(async (tx) => {
      const targetAccountId = tx
        .select({ account_id: planAccount.account_id })
        .from(planAccount)
        .where(eq(planAccount.plan_account_id, planAccountId))
        .limit(1);

      const currentPlans = await tx
        .select({
          plan_account_id: planAccount.plan_account_id,
          cancellation_date: planAccount.cancellation_date,
        })
        .from(planAccount)
        .where(sql`${planAccount.account_id} = (${targetAccountId})`)
        .orderBy(
          sql`${planAccount.updated_at} DESC NULLS LAST`,
          sql`${planAccount.created_at} DESC NULLS LAST`,
          sql`${planAccount.plan_account_id} DESC`
        )
        .limit(1)
        .for('update')
        .execute();

      const currentPlan = currentPlans[0];
      if (
        !currentPlan ||
        currentPlan.plan_account_id !== planAccountId ||
        currentPlan.cancellation_date
      ) {
        return false;
      }

      const result = await tx
        .update(planAccount)
        .set(updateData)
        .where(
          and(
            eq(planAccount.plan_account_id, currentPlan.plan_account_id),
            isNull(planAccount.cancellation_date)
          )
        )
        .execute();

      return (result.rowCount ?? 0) > 0;
    });
  };

  findCancelledPlanAccount = async (accountId: string) => {
    const result = await this.dbRw
      .select({
        plan_account_id: planAccount.plan_account_id,
        account_id: planAccount.account_id,
        cancellation_date: planAccount.cancellation_date,
        next_payment_date: planAccount.next_payment_date,
        account_status_id: account.account_status_id,
        account_deleted_at: account.deleted_at,
      })
      .from(planAccount)
      .innerJoin(account, eq(planAccount.account_id, account.account_id))
      .where(eq(planAccount.account_id, accountId))
      .orderBy(
        sql`${planAccount.updated_at} DESC NULLS LAST`,
        sql`${planAccount.created_at} DESC NULLS LAST`,
        sql`${planAccount.plan_account_id} DESC`
      )
      .limit(1)
      .execute();

    const currentPlan = result[0];
    if (
      !currentPlan ||
      currentPlan.account_deleted_at ||
      currentPlan.account_status_id === EAccountStatus.blocked ||
      (!currentPlan.cancellation_date &&
        currentPlan.account_status_id !== EAccountStatus.inactive)
    ) {
      return null;
    }

    return {
      plan_account_id: currentPlan.plan_account_id,
      account_id: currentPlan.account_id,
      cancellation_date: currentPlan.cancellation_date,
      next_payment_date: currentPlan.next_payment_date,
    };
  };
}
