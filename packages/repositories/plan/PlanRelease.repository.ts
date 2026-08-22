import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  accountPayment,
  planAccount,
  accountPaymentCrossSell,
  accountPlanProductEntitlementRevision,
  planCrossSellAccount,
  planCrossSell,
  planItems,
  plan,
  nfse,
  account,
} from '@core/models';
import { randomUUID } from 'node:crypto';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { currentTime } from '@core/common/functions/currentTime';
import { EAccountPaymentReleaseStatus } from '@core/common/enums/EAccountPaymentReleaseStatus';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';

@injectable()
export class PlanReleaseRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly isSuccessfulPaymentStatus = (statusId: string): boolean =>
    statusId === EPaymentStatus.received ||
    statusId === EPaymentStatus.confirmed ||
    statusId === EPaymentStatus.received_in_cash;

  private readonly isRevokingPaymentStatus = (statusId: string): boolean =>
    statusId === EPaymentStatus.refunded ||
    statusId === EPaymentStatus.refund_requested ||
    statusId === EPaymentStatus.refund_in_progress ||
    statusId === EPaymentStatus.chargeback_requested ||
    statusId === EPaymentStatus.chargeback_dispute ||
    statusId === EPaymentStatus.awaiting_chargeback_reversal;

  private readonly isIncomingStatusObservationNewer = (input: {
    currentObservedAt: string | null;
    currentEventId: string | null;
    currentStatusId: string;
    incomingObservedAt?: string;
    incomingEventId?: string;
    incomingStatusId: string;
  }): boolean => {
    if (!input.incomingObservedAt && !input.incomingEventId) {
      return input.currentObservedAt === null;
    }
    if (!input.incomingObservedAt || !input.incomingEventId) {
      throw new Error('payment_status_event_order_invalid');
    }

    const incomingTimestamp = Date.parse(input.incomingObservedAt);
    const currentTimestamp = input.currentObservedAt
      ? Date.parse(input.currentObservedAt)
      : Number.NEGATIVE_INFINITY;
    if (!Number.isFinite(incomingTimestamp) || Number.isNaN(currentTimestamp)) {
      throw new Error('payment_status_event_order_invalid');
    }
    if (incomingTimestamp !== currentTimestamp) {
      return incomingTimestamp > currentTimestamp;
    }

    const statusRank = (statusId: string): number => {
      if (this.isRevokingPaymentStatus(statusId)) return 3;
      if (this.isSuccessfulPaymentStatus(statusId)) return 2;
      return 1;
    };
    const currentRank = statusRank(input.currentStatusId);
    const incomingRank = statusRank(input.incomingStatusId);
    if (currentRank !== incomingRank) {
      return incomingRank > currentRank;
    }

    return input.incomingEventId > (input.currentEventId ?? '');
  };

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
    payment_status_observed_at: string | null;
    payment_status_event_id: string | null;
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
        payment_status_observed_at: true,
        payment_status_event_id: true,
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
    payment_status_observed_at: string | null;
    payment_status_event_id: string | null;
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
        payment_status_observed_at: true,
        payment_status_event_id: true,
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
      statusObservedAt?: string;
      statusEventId?: string;
    }
  ): Promise<void> => {
    const updateData: {
      payment_status_id: string;
      payment_date: string | null;
      pix_transaction?: string | null;
      release_status?: string | null;
      release_processed_at?: string | null;
      release_last_error?: string | null;
      payment_status_observed_at?: string;
      payment_status_event_id?: string;
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

    if (
      releaseUpdate?.statusObservedAt !== undefined ||
      releaseUpdate?.statusEventId !== undefined
    ) {
      if (!releaseUpdate.statusObservedAt || !releaseUpdate.statusEventId) {
        throw new Error('payment_status_event_order_invalid');
      }
      updateData.payment_status_observed_at = releaseUpdate.statusObservedAt;
      updateData.payment_status_event_id = releaseUpdate.statusEventId;
    }

    await tx
      .update(accountPayment)
      .set(updateData)
      .where(eq(accountPayment.account_payment_id, accountPaymentId));
  };

  private readonly buildPaymentRevocationProjectionQuery = (data: {
    accountId: string;
    accountPaymentId: string;
    planProductId: string;
  }): SQL<{ projected_allowed: boolean }> => sql<{
    projected_allowed: boolean;
  }>`
      WITH latest_plan AS MATERIALIZED (
        SELECT
          current_plan.plan_account_id,
          current_plan.plan_id,
          current_plan.account_payment_id,
          current_plan.last_payment_date,
          current_plan.next_payment_date
        FROM ${planAccount} current_plan
        WHERE current_plan.account_id = ${data.accountId}::uuid
        ORDER BY
          current_plan.updated_at DESC NULLS LAST,
          current_plan.created_at DESC NULLS LAST,
          current_plan.plan_account_id DESC
        LIMIT 1
      )
      SELECT COALESCE((
        owner.account_id IS NOT NULL
        AND owner.deleted_at IS NULL
        AND owner.account_status_id <> ${EAccountStatus.blocked}::uuid
        AND current_plan.plan_account_id IS NOT NULL
        AND current_plan.account_payment_id IS DISTINCT FROM
          ${data.accountPaymentId}::uuid
        AND selected_plan.deleted_at IS NULL
        AND selected_plan.status = ${EPlanStatus.active}
        AND current_plan.next_payment_date > clock_timestamp()
        AND (
          EXISTS (
            SELECT 1
            FROM ${planItems} item
            WHERE item.plan_id = current_plan.plan_id
              AND item.plan_product_id = ${data.planProductId}::uuid
              AND item.quantity > 0
              AND item.deleted_at IS NULL
          )
          OR EXISTS (
            SELECT 1
            FROM ${planCrossSellAccount} assignment
            INNER JOIN ${planCrossSell} addon
              ON addon.plan_cross_sell_id = assignment.plan_cross_sell_id
            WHERE assignment.account_id = ${data.accountId}::uuid
              AND assignment.account_payment_id IS DISTINCT FROM
                ${data.accountPaymentId}::uuid
              AND assignment.deleted_at IS NULL
              AND addon.deleted_at IS NULL
              AND addon.plan_product_id = ${data.planProductId}::uuid
              AND addon.quantity > 0
              AND (
                assignment.cancellation_date IS NULL
                OR current_plan.last_payment_date IS NULL
                OR assignment.cancellation_date >=
                  current_plan.last_payment_date
              )
          )
        )
      ), FALSE) AS projected_allowed
      FROM (SELECT 1) requested
      LEFT JOIN ${account} owner
        ON owner.account_id = ${data.accountId}::uuid
      LEFT JOIN latest_plan current_plan ON TRUE
      LEFT JOIN ${plan} selected_plan
        ON selected_plan.plan_id = current_plan.plan_id
    `;

  willGrantIntegrationAfterPaymentRevocation = async (data: {
    accountId: string;
    accountPaymentId: string;
    planProductId: string;
  }): Promise<boolean> => {
    const result = await this.dbRw.execute(
      this.buildPaymentRevocationProjectionQuery(data)
    );

    return result.rows[0]?.projected_allowed === true;
  };

  processPaymentRevocation = async (data: {
    accountPaymentId: string;
    accountId: string;
    paymentStatusId: string;
    paymentDate: string | null;
    pixTransaction: string | null | undefined;
    planProductId: string;
    denyFenceOwnerToken?: string;
    statusObservedAt: string;
    statusEventId: string;
  }): Promise<{
    applied: boolean;
    requiresDenyFence: boolean;
    ignoredAsStale: boolean;
  }> => {
    return this.dbRw.transaction(async (tx) => {
      const lockedPayments = await tx
        .select({
          account_id: accountPayment.account_id,
          payment_status_id: accountPayment.payment_status_id,
          payment_status_observed_at: accountPayment.payment_status_observed_at,
          payment_status_event_id: accountPayment.payment_status_event_id,
        })
        .from(accountPayment)
        .where(
          and(
            eq(accountPayment.account_payment_id, data.accountPaymentId),
            eq(accountPayment.account_id, data.accountId)
          )
        )
        .limit(1)
        .for('update');

      if (lockedPayments.length === 0) {
        throw new Error(
          `Pagamento não encontrado para revogação: ${data.accountPaymentId}`
        );
      }

      const lockedPayment = lockedPayments[0];
      if (
        !this.isIncomingStatusObservationNewer({
          currentObservedAt: lockedPayment.payment_status_observed_at,
          currentEventId: lockedPayment.payment_status_event_id,
          currentStatusId: lockedPayment.payment_status_id,
          incomingObservedAt: data.statusObservedAt,
          incomingEventId: data.statusEventId,
          incomingStatusId: data.paymentStatusId,
        })
      ) {
        return {
          applied: false,
          requiresDenyFence: false,
          ignoredAsStale: true,
        };
      }

      // Every account with an effective entitlement has one deterministic
      // current plan row. Payment release already writes this row after the
      // account_payment row, so taking the locks in that same order avoids an
      // advisory/row-lock inversion and serializes refunds from distinct
      // add-on payments of the same account.
      await tx
        .select({ plan_account_id: planAccount.plan_account_id })
        .from(planAccount)
        .where(eq(planAccount.account_id, data.accountId))
        .orderBy(
          sql`${planAccount.updated_at} DESC NULLS LAST`,
          sql`${planAccount.created_at} DESC NULLS LAST`,
          sql`${planAccount.plan_account_id} DESC`
        )
        .limit(1)
        .for('update');

      const projection = await tx.execute(
        this.buildPaymentRevocationProjectionQuery(data)
      );
      const projectedAllowed = projection.rows[0]?.projected_allowed === true;

      if (!projectedAllowed) {
        const fenceState = await tx
          .select({
            allowed: accountPlanProductEntitlementRevision.allowed,
            deny_fence_token:
              accountPlanProductEntitlementRevision.deny_fence_token,
            deny_fence_created_at:
              accountPlanProductEntitlementRevision.deny_fence_created_at,
            deny_fence_released_at:
              accountPlanProductEntitlementRevision.deny_fence_released_at,
          })
          .from(accountPlanProductEntitlementRevision)
          .where(
            and(
              eq(
                accountPlanProductEntitlementRevision.account_id,
                data.accountId
              ),
              eq(
                accountPlanProductEntitlementRevision.plan_product_id,
                data.planProductId
              )
            )
          )
          .limit(1);
        const persisted = fenceState[0];
        const hasOwnedActiveFence =
          data.denyFenceOwnerToken !== undefined &&
          persisted?.deny_fence_token === data.denyFenceOwnerToken &&
          persisted.deny_fence_created_at !== null &&
          persisted.deny_fence_released_at === null;
        const wasAlreadyDenied = persisted?.allowed === false;

        if (!hasOwnedActiveFence && !wasAlreadyDenied) {
          return {
            applied: false,
            requiresDenyFence: true,
            ignoredAsStale: false,
          };
        }
      }

      await this.updateAccountPaymentStatus(
        tx,
        data.accountPaymentId,
        data.paymentStatusId,
        data.paymentDate,
        data.pixTransaction,
        {
          releaseStatus: EAccountPaymentReleaseStatus.pending,
          releaseProcessedAt: null,
          releaseLastError: null,
          statusObservedAt: data.statusObservedAt,
          statusEventId: data.statusEventId,
        }
      );

      await tx
        .update(planAccount)
        .set({
          next_payment_date: sql`clock_timestamp()`,
          cancellation_date: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(planAccount.account_id, data.accountId),
            eq(planAccount.account_payment_id, data.accountPaymentId),
            or(
              isNull(planAccount.next_payment_date),
              gt(planAccount.next_payment_date, sql`clock_timestamp()`)
            )
          )
        );

      await tx
        .update(planCrossSellAccount)
        .set({
          deleted_at: sql`clock_timestamp()`,
          updated_at: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(planCrossSellAccount.account_id, data.accountId),
            eq(planCrossSellAccount.account_payment_id, data.accountPaymentId),
            isNull(planCrossSellAccount.deleted_at)
          )
        );

      return {
        applied: true,
        requiresDenyFence: false,
        ignoredAsStale: false,
      };
    });
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
      orderBy: (planAccount, { desc }) => [
        desc(planAccount.updated_at),
        desc(planAccount.created_at),
        desc(planAccount.plan_account_id),
      ],
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
      orderBy: (planAccount, { desc }) => [
        desc(planAccount.updated_at),
        desc(planAccount.created_at),
        desc(planAccount.plan_account_id),
      ],
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
      orderBy: (planAccount, { desc }) => [
        desc(planAccount.updated_at),
        desc(planAccount.created_at),
        desc(planAccount.plan_account_id),
      ],
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
    allowFinancialReversal?: boolean;
    statusObservedAt?: string;
    statusEventId?: string;
  }): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      const currentPayments = await tx
        .select({
          release_status: accountPayment.release_status,
          payment_status_id: accountPayment.payment_status_id,
          payment_status_observed_at: accountPayment.payment_status_observed_at,
          payment_status_event_id: accountPayment.payment_status_event_id,
        })
        .from(accountPayment)
        .where(eq(accountPayment.account_payment_id, data.accountPaymentId))
        .limit(1)
        .for('update');
      const currentPayment = currentPayments[0];

      if (!currentPayment) {
        throw new Error(`Pagamento não encontrado: ${data.accountPaymentId}`);
      }

      const isNewerObservation = this.isIncomingStatusObservationNewer({
        currentObservedAt: currentPayment.payment_status_observed_at,
        currentEventId: currentPayment.payment_status_event_id,
        currentStatusId: currentPayment.payment_status_id,
        incomingObservedAt: data.statusObservedAt,
        incomingEventId: data.statusEventId,
        incomingStatusId: data.paymentStatusId,
      });
      if (!isNewerObservation) {
        return false;
      }

      if (
        this.isRevokingPaymentStatus(currentPayment.payment_status_id) &&
        this.isSuccessfulPaymentStatus(data.paymentStatusId) &&
        data.allowFinancialReversal !== true
      ) {
        // A delayed local credit-card response cannot overwrite a newer
        // refund/chargeback. Only the authoritative webhook reversal path may
        // materialize the payment again.
        return false;
      }

      if (data.allowFinancialReversal === true && data.shouldReleasePlan) {
        const currentPlanAccounts = await tx
          .select({ account_payment_id: planAccount.account_payment_id })
          .from(planAccount)
          .where(eq(planAccount.account_id, data.accountId))
          .orderBy(
            sql`${planAccount.updated_at} DESC NULLS LAST`,
            sql`${planAccount.created_at} DESC NULLS LAST`,
            sql`${planAccount.plan_account_id} DESC`
          )
          .limit(1)
          .for('update');
        if (
          currentPlanAccounts[0]?.account_payment_id !== data.accountPaymentId
        ) {
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
              statusObservedAt: data.statusObservedAt,
              statusEventId: data.statusEventId,
            }
          );
          return false;
        }
      }

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
          statusObservedAt: data.statusObservedAt,
          statusEventId: data.statusEventId,
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

        return true;
      }

      if (data.isAddonOnly && !isReleaseAlreadyProcessed) {
        await this.appendPlanCrossSellAccount(tx, {
          accountId: data.accountId,
          accountPaymentId: data.accountPaymentId,
        });
      }

      return true;
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
      where: and(
        eq(accountPaymentCrossSell.account_payment_id, accountPaymentId),
        gt(accountPaymentCrossSell.quantity, 0)
      ),
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
    await tx
      .update(planCrossSellAccount)
      .set({
        deleted_at: now,
        updated_at: now,
      })
      .where(
        inArray(
          planCrossSellAccount.plan_cross_sell_account_id,
          accounts.map((existing) => existing.plan_cross_sell_account_id)
        )
      );
  };

  private readonly createPlanCrossSellAccounts = async (
    tx: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0],
    accountId: string,
    accountPaymentId: string,
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
      account_payment_id: accountPaymentId,
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
      data.accountPaymentId,
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
      data.accountPaymentId,
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
