import * as schema from '@core/models';
import { planAccount, worker, accountPaymentNfSe, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, isNotNull, or } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';
import { IPlanAccountWithCancellation } from '@core/common/interfaces/IPlanAccountWithCancellation';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class PlanAccountCancellerRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  findPlanAccountWithPayment = async (accountId: string) => {
    return this.dbRw.query.planAccount.findFirst({
      where: and(
        eq(planAccount.account_id, accountId),
        isNull(planAccount.cancellation_date)
      ),
      columns: {
        plan_account_id: true,
        account_payment_id: true,
        last_payment_date: true,
        next_payment_date: true,
        cancellation_date: true,
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
      .where(
        and(
          eq(planAccount.account_id, accountId),
          isNull(planAccount.cancellation_date)
        )
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

  cancelPlanAccount = async (
    accountId: string,
    cancellationDate: string,
    shouldCancelNextPayment: boolean
  ): Promise<boolean> => {
    const updateData: {
      cancellation_date: string;
      next_payment_date?: null;
      recurring_payment: boolean;
      updated_at: string;
    } = {
      cancellation_date: cancellationDate,
      recurring_payment: false,
      updated_at: currentTime(),
    };

    if (shouldCancelNextPayment) {
      updateData.next_payment_date = null;
    }

    const result = await this.dbRw
      .update(planAccount)
      .set(updateData)
      .where(
        and(
          eq(planAccount.account_id, accountId),
          isNull(planAccount.cancellation_date)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
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
      updated_at: string;
    } = {
      cancellation_date: cancellationDate,
      recurring_payment: false,
      updated_at: currentTime(),
    };

    if (shouldCancelNextPayment) {
      updateData.next_payment_date = null;
    }

    const result = await this.dbRw
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
  };

  findCancelledPlanAccount = async (accountId: string) => {
    const result = await this.dbRw
      .select({
        plan_account_id: planAccount.plan_account_id,
        account_id: planAccount.account_id,
        cancellation_date: planAccount.cancellation_date,
        next_payment_date: planAccount.next_payment_date,
      })
      .from(planAccount)
      .innerJoin(account, eq(planAccount.account_id, account.account_id))
      .where(
        and(
          eq(planAccount.account_id, accountId),
          or(
            isNotNull(planAccount.cancellation_date),
            eq(account.account_status_id, EAccountStatus.inactive)
          )
        )
      )
      .limit(1)
      .execute();

    return result[0] || null;
  };
}
