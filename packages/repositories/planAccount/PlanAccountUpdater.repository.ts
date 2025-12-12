import * as schema from '@core/models';
import { planAccount, plan, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, and, isNull } from 'drizzle-orm';
import { UpdatePlanAccountRequest } from '@core/schema/planAccount/updatePlanAccount/request.schema';
import { currentTime } from '@core/common/functions/currentTime';
import { v7 as uuidv7 } from 'uuid';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { ICalculatedPlanAccountData } from '@core/common/interfaces/IPlanAccountUpdater';

@injectable()
export class PlanAccountUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  findPlanAccountByAccountId = async (accountId: string) => {
    return this.db.query.planAccount.findFirst({
      where: and(
        eq(planAccount.account_id, accountId),
        isNull(planAccount.cancellation_date)
      ),
      columns: {
        plan_account_id: true,
        plan_id: true,
        recurring_payment: true,
        billing_period_id: true,
        last_payment_date: true,
        next_payment_date: true,
        cancellation_date: true,
        value: true,
      },
    });
  };

  createOrUpdatePlanAccountByAccountId = async (
    accountId: string,
    input: UpdatePlanAccountRequest
  ): Promise<boolean> => {
    return this.db.transaction(async (tx) => {
      const existingPlanAccount = await this.findExistingPlanAccount(
        tx,
        accountId
      );
      const planData = await this.findPlanData(tx, input.plan_id);

      const lastPaymentDate = this.determineLastPaymentDate(
        input.last_payment_date,
        existingPlanAccount?.last_payment_date
      );

      const nextPaymentDate = this.calculateNextPaymentDate(
        input.next_payment_date,
        lastPaymentDate,
        planData,
        input.billing_period_id
      );

      const planValue = this.determinePlanValue(
        input.value,
        planData,
        input.billing_period_id
      );

      const recurringPayment = this.determineRecurringPayment(
        planData.is_test,
        input.recurring_payment
      );

      const billingPeriodId = this.determineBillingPeriodId(
        planData.is_test,
        input.billing_period_id
      );

      const calculatedData: ICalculatedPlanAccountData = {
        recurringPayment,
        billingPeriodId,
        lastPaymentDate,
        nextPaymentDate,
        planValue,
      };

      if (existingPlanAccount) {
        const planUpdated = await this.updateExistingPlanAccount(
          tx,
          accountId,
          input,
          calculatedData
        );
        await this.ensureAccountIsActive(tx, accountId);

        return planUpdated;
      }

      const planCreated = await this.createNewPlanAccount(
        tx,
        accountId,
        input,
        calculatedData
      );
      await this.ensureAccountIsActive(tx, accountId);

      return planCreated;
    });
  };

  private readonly findExistingPlanAccount = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    accountId: string
  ) => {
    return tx.query.planAccount.findFirst({
      where: and(
        eq(planAccount.account_id, accountId),
        isNull(planAccount.cancellation_date)
      ),
      columns: {
        plan_account_id: true,
        last_payment_date: true,
      },
    });
  };

  private readonly findPlanData = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    planId: string
  ) => {
    const planData = await tx.query.plan.findFirst({
      where: and(eq(plan.plan_id, planId), isNull(plan.deleted_at)),
      columns: {
        plan_id: true,
        price: true,
        annual_discount: true,
        is_test: true,
        days_trial: true,
      },
    });

    if (!planData) {
      throw new Error('Plan not found');
    }

    return planData;
  };

  private readonly determineLastPaymentDate = (
    inputLastPaymentDate: string | null | undefined,
    existingLastPaymentDate: string | null | undefined
  ): Date => {
    if (inputLastPaymentDate) {
      return new Date(inputLastPaymentDate);
    }

    if (existingLastPaymentDate) {
      return new Date(existingLastPaymentDate);
    }

    return new Date();
  };

  private readonly calculateNextPaymentDate = (
    inputNextPaymentDate: string | null | undefined,
    lastPaymentDate: Date,
    planData: {
      is_test: boolean;
      days_trial: number | null;
    },
    billingPeriodId: string | undefined
  ): Date => {
    if (inputNextPaymentDate) {
      return new Date(inputNextPaymentDate);
    }

    if (planData.is_test && planData.days_trial) {
      return this.calculateTestPlanNextPaymentDate(
        lastPaymentDate,
        planData.days_trial
      );
    }

    return this.calculateRegularPlanNextPaymentDate(
      lastPaymentDate,
      billingPeriodId
    );
  };

  private readonly calculateTestPlanNextPaymentDate = (
    lastPaymentDate: Date,
    daysTrial: number
  ): Date => {
    const nextPaymentDate = new Date(lastPaymentDate);
    nextPaymentDate.setDate(nextPaymentDate.getDate() + daysTrial);
    return nextPaymentDate;
  };

  private readonly calculateRegularPlanNextPaymentDate = (
    lastPaymentDate: Date,
    billingPeriodId: string | undefined
  ): Date => {
    const periodId = billingPeriodId || EBillingPeriod.monthly;
    const daysToAdd = periodId === EBillingPeriod.annual ? 365 : 30;
    const nextPaymentDate = new Date(lastPaymentDate);
    nextPaymentDate.setDate(nextPaymentDate.getDate() + daysToAdd);
    return nextPaymentDate;
  };

  private readonly determinePlanValue = (
    inputValue: string | undefined,
    planData: {
      is_test: boolean;
      price: string | null;
      annual_discount: string | null;
    },
    billingPeriodId: string | undefined
  ): string => {
    if (inputValue) {
      return inputValue;
    }

    if (planData.is_test) {
      return '0';
    }

    return this.calculateRegularPlanValue(planData, billingPeriodId);
  };

  private readonly calculateRegularPlanValue = (
    planData: {
      price: string | null;
      annual_discount: string | null;
    },
    billingPeriodId: string | undefined
  ): string => {
    const monthlyPrice = Number(planData.price);
    const periodId = billingPeriodId || EBillingPeriod.monthly;

    if (periodId === EBillingPeriod.annual) {
      return this.calculateAnnualPrice(monthlyPrice, planData.annual_discount);
    }

    return monthlyPrice.toString();
  };

  private readonly calculateAnnualPrice = (
    monthlyPrice: number,
    annualDiscount: string | null
  ): string => {
    const annualPrice = monthlyPrice * 12;

    if (!annualDiscount) {
      return annualPrice.toString();
    }

    const discount = Number.parseFloat(annualDiscount);
    return (annualPrice * (1 - discount / 100)).toString();
  };

  private readonly determineRecurringPayment = (
    isTest: boolean,
    inputRecurringPayment: boolean | undefined
  ): boolean => {
    if (isTest) {
      return false;
    }

    return inputRecurringPayment ?? false;
  };

  private readonly determineBillingPeriodId = (
    isTest: boolean,
    inputBillingPeriodId: string | undefined
  ): string => {
    if (isTest) {
      return EBillingPeriod.monthly;
    }

    return inputBillingPeriodId || EBillingPeriod.monthly;
  };

  private readonly updateExistingPlanAccount = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    accountId: string,
    input: UpdatePlanAccountRequest,
    calculatedData: ICalculatedPlanAccountData
  ): Promise<boolean> => {
    const updateData = {
      plan_id: input.plan_id,
      recurring_payment: calculatedData.recurringPayment,
      billing_period_id: calculatedData.billingPeriodId,
      last_payment_date: calculatedData.lastPaymentDate.toISOString(),
      next_payment_date: calculatedData.nextPaymentDate.toISOString(),
      cancellation_date: input.cancellation_date || null,
      value: calculatedData.planValue,
      updated_at: currentTime(),
    };

    const result = await tx
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

  private readonly createNewPlanAccount = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    accountId: string,
    input: UpdatePlanAccountRequest,
    calculatedData: ICalculatedPlanAccountData
  ): Promise<boolean> => {
    const planAccountId = uuidv7();
    const now = currentTime();

    await tx.insert(planAccount).values({
      plan_account_id: planAccountId,
      account_id: accountId,
      plan_id: input.plan_id,
      account_payment_id: null,
      recurring_payment: calculatedData.recurringPayment,
      billing_period_id: calculatedData.billingPeriodId,
      last_payment_date: calculatedData.lastPaymentDate.toISOString(),
      next_payment_date: calculatedData.nextPaymentDate.toISOString(),
      cancellation_date: input.cancellation_date || null,
      value: calculatedData.planValue,
      created_at: now,
      updated_at: now,
    });

    return true;
  };

  private readonly ensureAccountIsActive = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    accountId: string
  ): Promise<void> => {
    const accountData = await tx.query.account.findFirst({
      where: eq(account.account_id, accountId),
      columns: {
        account_status_id: true,
      },
    });

    if (!accountData) {
      return;
    }

    if (accountData.account_status_id !== EAccountStatus.active) {
      await tx
        .update(account)
        .set({
          account_status_id: EAccountStatus.active,
          updated_at: currentTime(),
        })
        .where(eq(account.account_id, accountId));
    }
  };

  updatePlanAccountByAccountId = async (
    accountId: string,
    input: UpdatePlanAccountRequest
  ): Promise<boolean> => {
    return this.createOrUpdatePlanAccountByAccountId(accountId, input);
  };
}
