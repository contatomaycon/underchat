import * as schema from '@core/models';
import {
  account,
  accountPayment,
  accountStatus,
  billingPeriod,
  permissionAssignment,
  permissionRole,
  plan,
  planAccount,
  sector,
  sectorUser,
  user,
  userChannel,
  userDocument,
  userInfo,
  userStatus,
  worker,
} from '@core/models';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import type { ChatbotUnderchatLookupType } from '@core/common/interfaces/IChatbotUnderchatLookup';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

export interface ChatbotUnderchatUserRecord {
  readonly userId: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly encryptedEmail: string;
  readonly userStatus: string;
  readonly accountStatus: string;
}

export interface ChatbotUnderchatUserInfoRecord {
  readonly name: string;
  readonly lastName: string;
  readonly phoneDdi: string | null;
  readonly encryptedPhone: string | null;
}

export interface ChatbotUnderchatPlanRecord {
  readonly planName: string;
  readonly billingPeriod: string | null;
  readonly nextPaymentAt: string | null;
}

export interface ChatbotUnderchatPaymentRecord {
  readonly paidAt: string;
  readonly amount: string;
}

const PAID_PAYMENT_STATUSES: readonly string[] = [
  EPaymentStatus.received,
  EPaymentStatus.confirmed,
  EPaymentStatus.received_in_cash,
  EPaymentStatus.dunning_received,
];

@injectable()
export class ChatbotUnderchatUserLookupRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  public findNewestUser = async (input: {
    lookupType: ChatbotUnderchatLookupType;
    identityHashes: readonly string[];
  }): Promise<ChatbotUnderchatUserRecord | null> => {
    if (input.identityHashes.length === 0) return null;

    const identityCondition: SQL =
      input.lookupType === 'email'
        ? inArray(user.email_c, [...input.identityHashes])
        : inArray(
            user.user_id,
            this.dbRo
              .select({ userId: userDocument.user_id })
              .from(userDocument)
              .where(
                inArray(userDocument.document_c, [...input.identityHashes])
              )
          );

    const rows = await this.dbRo
      .select({
        userId: user.user_id,
        accountId: account.account_id,
        accountName: account.name,
        encryptedEmail: user.email,
        userStatus: userStatus.name,
        accountStatus: accountStatus.name,
      })
      .from(user)
      .innerJoin(account, eq(user.account_id, account.account_id))
      .innerJoin(userStatus, eq(user.user_status_id, userStatus.user_status_id))
      .innerJoin(
        accountStatus,
        eq(account.account_status_id, accountStatus.account_status_id)
      )
      .where(
        and(
          isNull(user.deleted_at),
          isNull(account.deleted_at),
          identityCondition
        )
      )
      .orderBy(sql`${user.created_at} DESC NULLS LAST`, desc(user.user_id))
      .limit(1)
      .execute();

    return rows[0] ?? null;
  };

  public findLatestUserInfo = async (
    userId: string
  ): Promise<ChatbotUnderchatUserInfoRecord | null> => {
    const rows = await this.dbRo
      .select({
        name: userInfo.name,
        lastName: userInfo.last_name,
        phoneDdi: userInfo.phone_ddi,
        encryptedPhone: userInfo.phone,
      })
      .from(userInfo)
      .where(and(eq(userInfo.user_id, userId), isNull(userInfo.deleted_at)))
      .orderBy(
        sql`${userInfo.created_at} DESC NULLS LAST`,
        desc(userInfo.user_info_id)
      )
      .limit(1)
      .execute();

    return rows[0] ?? null;
  };

  public findLatestDocument = async (input: {
    userId: string;
    preferredHashes?: readonly string[];
  }): Promise<string | null> => {
    const conditions: SQL[] = [eq(userDocument.user_id, input.userId)];
    if (input.preferredHashes?.length) {
      conditions.push(
        inArray(userDocument.document_c, [...input.preferredHashes])
      );
    }

    const rows = await this.dbRo
      .select({ encryptedDocument: userDocument.document })
      .from(userDocument)
      .where(and(...conditions))
      .orderBy(
        sql`${userDocument.created_at} DESC NULLS LAST`,
        desc(userDocument.user_document_id)
      )
      .limit(1)
      .execute();

    return rows[0]?.encryptedDocument ?? null;
  };

  public findAccessGroup = async (userId: string): Promise<string | null> => {
    // Full-access users can retain permission links from a different account.
    // The assignment belongs to the user, so it must not be discarded here.
    const rows = await this.dbRo
      .select({ name: permissionRole.name })
      .from(permissionAssignment)
      .innerJoin(
        permissionRole,
        eq(
          permissionAssignment.permission_role_id,
          permissionRole.permission_role_id
        )
      )
      .where(
        and(
          eq(permissionAssignment.user_id, userId),
          isNull(permissionRole.deleted_at)
        )
      )
      .orderBy(
        sql`${permissionAssignment.created_at} DESC NULLS LAST`,
        desc(permissionAssignment.permission_assignment_id)
      )
      .limit(1)
      .execute();

    return rows[0]?.name ?? null;
  };

  public listSectors = async (userId: string): Promise<string[]> => {
    // Sector assignments are resolved by user across the application and may
    // legitimately outlive an account change.
    const rows = await this.dbRo
      .selectDistinct({ name: sector.name })
      .from(sectorUser)
      .innerJoin(sector, eq(sectorUser.sector_id, sector.sector_id))
      .where(
        and(
          eq(sectorUser.user_id, userId),
          isNull(sectorUser.deleted_at),
          isNull(sector.deleted_at)
        )
      )
      .orderBy(sector.name)
      .execute();

    return rows.map(({ name }) => name);
  };

  public listChannels = async (input: {
    accountId: string;
    userId: string;
  }): Promise<string[]> => {
    const rows = await this.dbRo
      .selectDistinct({ name: worker.name })
      .from(userChannel)
      .innerJoin(worker, eq(userChannel.channel_id, worker.worker_id))
      .where(
        and(
          eq(userChannel.user_id, input.userId),
          eq(userChannel.account_id, input.accountId),
          eq(worker.account_id, input.accountId),
          isNull(worker.deleted_at)
        )
      )
      .orderBy(worker.name)
      .execute();

    return rows.map(({ name }) => name);
  };

  public listAllAccountChannels = async (
    accountId: string
  ): Promise<string[]> => {
    const rows = await this.dbRo
      .selectDistinct({ name: worker.name })
      .from(worker)
      .where(and(eq(worker.account_id, accountId), isNull(worker.deleted_at)))
      .orderBy(worker.name)
      .execute();

    return rows.map(({ name }) => name);
  };

  public findCurrentOrRecentPlan = async (
    accountId: string
  ): Promise<ChatbotUnderchatPlanRecord | null> => {
    const activeRank = sql<number>`CASE
      WHEN ${planAccount.next_payment_date} > NOW()
        AND (${planAccount.cancellation_date} IS NULL OR ${planAccount.cancellation_date} > NOW())
      THEN 1 ELSE 0 END`;
    const recentAt = sql<string>`GREATEST(
      COALESCE(${planAccount.last_payment_date}, 'epoch'::timestamptz),
      COALESCE(${planAccount.cancellation_date}, 'epoch'::timestamptz),
      COALESCE(${planAccount.created_at}, 'epoch'::timestamptz)
    )`;
    const currentNextPaymentAt = sql<string | null>`CASE
      WHEN ${planAccount.next_payment_date} > NOW()
        AND (${planAccount.cancellation_date} IS NULL OR ${planAccount.cancellation_date} > NOW())
      THEN ${planAccount.next_payment_date}
      ELSE NULL END`;

    const rows = await this.dbRo
      .select({
        planName: plan.name,
        billingPeriod: billingPeriod.name,
        nextPaymentAt: currentNextPaymentAt,
      })
      .from(planAccount)
      .innerJoin(plan, eq(planAccount.plan_id, plan.plan_id))
      .leftJoin(
        billingPeriod,
        eq(planAccount.billing_period_id, billingPeriod.billing_period_id)
      )
      .where(
        and(eq(planAccount.account_id, accountId), isNull(plan.deleted_at))
      )
      .orderBy(
        desc(activeRank),
        desc(recentAt),
        sql`${planAccount.created_at} DESC NULLS LAST`,
        desc(planAccount.plan_account_id)
      )
      .limit(1)
      .execute();

    return rows[0] ?? null;
  };

  public findLatestPaidPayment = async (
    accountId: string
  ): Promise<ChatbotUnderchatPaymentRecord | null> => {
    const rows = await this.dbRo
      .select({
        paidAt: accountPayment.payment_date,
        amount: accountPayment.value,
      })
      .from(accountPayment)
      .where(
        and(
          eq(accountPayment.account_id, accountId),
          inArray(accountPayment.payment_status_id, [...PAID_PAYMENT_STATUSES]),
          isNotNull(accountPayment.payment_date)
        )
      )
      .orderBy(
        desc(accountPayment.payment_date),
        sql`${accountPayment.created_at} DESC NULLS LAST`,
        desc(accountPayment.account_payment_id)
      )
      .limit(1)
      .execute();

    const payment = rows[0];
    if (!payment?.paidAt) return null;
    return { paidAt: payment.paidAt, amount: payment.amount };
  };
}
