import * as schema from '@core/models';
import { account, planAccount, apiKey, plan } from '@core/models';
import { CreateAccountRequest } from '@core/schema/account/createAccount/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { randomBytes } from 'node:crypto';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';
import { currentTime } from '@core/common/functions/currentTime';
import { eq, and, isNull } from 'drizzle-orm';

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
        const planData = await tx.query.plan.findFirst({
          where: and(
            eq(plan.plan_id, input.plan.plan_id),
            isNull(plan.deleted_at)
          ),
          columns: {
            plan_id: true,
            price: true,
            annual_discount: true,
          },
        });

        if (!planData) {
          throw new Error('Plan not found');
        }

        const planPrice = this.calculatePlanPrice(
          {
            price: Number(planData.price),
            annual_discount: planData.annual_discount,
          },
          input.plan.billing_period
        );

        const billingPeriodId =
          input.plan.billing_period === 'monthly'
            ? EBillingPeriod.monthly
            : EBillingPeriod.annual;

        const now = new Date();
        const nextPaymentDate = new Date(now);
        const daysToAdd = input.plan.billing_period === 'monthly' ? 30 : 365;
        nextPaymentDate.setDate(nextPaymentDate.getDate() + daysToAdd);

        const planAccountId = uuidv7();

        await tx.insert(planAccount).values({
          plan_account_id: planAccountId,
          account_id: accountId,
          plan_id: input.plan.plan_id,
          account_payment_id: null,
          recurring_payment: false,
          billing_period_id: billingPeriodId,
          last_payment_date: now.toISOString(),
          next_payment_date: nextPaymentDate.toISOString(),
          cancellation_date: null,
          value: planPrice.toString(),
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        });
      }

      const apiKeyId = uuidv7();
      const key = randomBytes(16).toString('hex');

      await tx.insert(apiKey).values({
        api_key_id: apiKeyId,
        account_id: accountId,
        key,
        name: input.name,
      });

      return accountId;
    });
  };

  private readonly calculatePlanPrice = (
    planData: { price: number; annual_discount: string | null },
    billingPeriod: 'monthly' | 'annual'
  ): number => {
    const monthlyPrice = Number(planData.price);

    if (billingPeriod !== 'annual') {
      return monthlyPrice;
    }

    const annualPrice = monthlyPrice * 12;
    if (!planData.annual_discount) {
      return annualPrice;
    }

    const discount = Number.parseFloat(planData.annual_discount);
    return annualPrice * (1 - discount / 100);
  };
}
