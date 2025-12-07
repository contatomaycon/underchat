import * as schema from '@core/models';
import { account, planAccount, apiKey, plan, accountInfo } from '@core/models';
import { CreateAccountRequest } from '@core/schema/account/createAccount/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { randomBytes } from 'node:crypto';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';
import { currentTime } from '@core/common/functions/currentTime';
import { eq, and, isNull } from 'drizzle-orm';
import { EContentWidth } from '@core/common/enums/EContentWidth';
import { EContentLayoutNav } from '@core/common/enums/EContentLayoutNav';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ESkin } from '@core/common/enums/ESkin';
import { ENavbar } from '@core/common/enums/ENavbar';
import { EFooter } from '@core/common/enums/EFooter';

@injectable()
export class AccountCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createAccount = async (
    input: CreateAccountRequest
  ): Promise<string | null> => {
    const accountId = uuidv7();

    const result = await this.db
      .insert(account)
      .values({
        account_id: accountId,
        account_status_id: input.account_status.account_status_id,
        name: input.name,
      })
      .execute();

    if (!result) {
      return null;
    }

    return accountId;
  };

  createAccountWithPlanAndApiKey = async (
    input: CreateAccountRequest
  ): Promise<string | null> => {
    return this.db.transaction(async (tx) => {
      const accountId = uuidv7();

      await tx.insert(account).values({
        account_id: accountId,
        account_status_id: input.account_status.account_status_id,
        name: input.name,
      });

      if (input.plan) {
        await this.createPlanAccountForAccount(tx, accountId, input.plan);
      }

      const apiKeyId = uuidv7();
      const key = randomBytes(16).toString('hex');

      await tx.insert(apiKey).values({
        api_key_id: apiKeyId,
        account_id: accountId,
        key,
        name: input.name,
      });

      const accountInfoId = uuidv7();
      const now = currentTime();

      await tx.insert(accountInfo).values({
        account_info_id: accountInfoId,
        account_id: accountId,
        content_width: EContentWidth.fluid,
        content_layout_nav: EContentLayoutNav.vertical,
        default_locale: ELanguage.pt,
        skin: ESkin.default,
        navbar: ENavbar.sticky,
        footer: EFooter.sticky,
        is_vertical_nav_collapsed: false,
        is_vertical_nav_semi_dark: true,
        light_primary_color: '#2865B7',
        light_secondary_color: '#5098E5',
        dark_primary_color: '#152642',
        dark_secondary_color: '#2865B7',
        created_at: now,
        updated_at: now,
      });

      return accountId;
    });
  };

  private readonly createPlanAccountForAccount = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    accountId: string,
    planInput: { plan_id: string; billing_period: 'monthly' | 'annual' }
  ): Promise<void> => {
    const planData = await this.findPlanData(tx, planInput.plan_id);
    const now = new Date();
    const planAccountId = uuidv7();

    if (planData.is_test && planData.days_trial) {
      await this.createTestPlanAccount(
        tx,
        planAccountId,
        accountId,
        planInput.plan_id,
        now,
        planData.days_trial
      );
      return;
    }

    await this.createRegularPlanAccount(
      tx,
      planAccountId,
      accountId,
      planInput,
      planData,
      now
    );
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

  private readonly createTestPlanAccount = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    planAccountId: string,
    accountId: string,
    planId: string,
    now: Date,
    daysTrial: number
  ): Promise<void> => {
    const nextPaymentDate = new Date(now);
    nextPaymentDate.setDate(nextPaymentDate.getDate() + daysTrial);

    await tx.insert(planAccount).values({
      plan_account_id: planAccountId,
      account_id: accountId,
      plan_id: planId,
      account_payment_id: null,
      recurring_payment: false,
      billing_period_id: EBillingPeriod.monthly,
      last_payment_date: now.toISOString(),
      next_payment_date: nextPaymentDate.toISOString(),
      cancellation_date: null,
      value: '0',
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
  };

  private readonly createRegularPlanAccount = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    planAccountId: string,
    accountId: string,
    planInput: { plan_id: string; billing_period: 'monthly' | 'annual' },
    planData: {
      price: string | null;
      annual_discount: string | null;
    },
    now: Date
  ): Promise<void> => {
    const planPrice = this.calculatePlanPrice(
      {
        price: Number(planData.price),
        annual_discount: planData.annual_discount,
      },
      planInput.billing_period
    );

    const billingPeriodId = this.getBillingPeriodId(planInput.billing_period);
    const nextPaymentDate = this.calculateNextPaymentDate(
      now,
      planInput.billing_period
    );

    await tx.insert(planAccount).values({
      plan_account_id: planAccountId,
      account_id: accountId,
      plan_id: planInput.plan_id,
      account_payment_id: null,
      recurring_payment: false,
      billing_period_id: billingPeriodId,
      last_payment_date: now.toISOString(),
      next_payment_date: nextPaymentDate,
      cancellation_date: null,
      value: planPrice.toString(),
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
  };

  private readonly getBillingPeriodId = (
    billingPeriod: 'monthly' | 'annual'
  ): string => {
    return billingPeriod === 'monthly'
      ? EBillingPeriod.monthly
      : EBillingPeriod.annual;
  };

  private readonly calculateNextPaymentDate = (
    now: Date,
    billingPeriod: 'monthly' | 'annual'
  ): string => {
    const nextPaymentDate = new Date(now);
    const daysToAdd = billingPeriod === 'monthly' ? 30 : 365;
    nextPaymentDate.setDate(nextPaymentDate.getDate() + daysToAdd);
    return nextPaymentDate.toISOString();
  };

  private readonly calculatePlanPrice = (
    planData: { price: number; annual_discount: string | null },
    billingPeriod: 'monthly' | 'annual'
  ): number => {
    const monthlyPrice = Number(planData.price);

    if (billingPeriod !== 'annual') {
      return monthlyPrice;
    }

    return this.calculateAnnualPrice(monthlyPrice, planData.annual_discount);
  };

  private readonly calculateAnnualPrice = (
    monthlyPrice: number,
    annualDiscount: string | null
  ): number => {
    const annualPrice = monthlyPrice * 12;

    if (!annualDiscount) {
      return annualPrice;
    }

    const discount = Number.parseFloat(annualDiscount);
    return annualPrice * (1 - discount / 100);
  };
}
