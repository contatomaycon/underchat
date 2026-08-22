import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';
import { PLAN_ENTITLEMENT_DENY_FENCE_TTL_SECONDS } from '@core/common/constants/planEntitlement';
import type { PlanEntitlementSource } from '@core/common/interfaces/IPlanEntitlement';
import * as schema from '@core/models';
import {
  account,
  accountPaymentCrossSell,
  accountPlanProductEntitlementRevision,
  plan,
  planAccount,
  planCrossSell,
  planCrossSellAccount,
  planItems,
} from '@core/models';
import { ExtractTablesWithRelations, eq, sql } from 'drizzle-orm';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { inject, injectable } from 'tsyringe';

export type { PlanEntitlementSource } from '@core/common/interfaces/IPlanEntitlement';

export interface ResolvedPlanEntitlement {
  readonly accountId: string;
  readonly planProductId: string;
  readonly allowed: boolean;
  readonly revision: string;
  readonly validUntil: string | null;
  readonly planIsActive: boolean;
  readonly source: PlanEntitlementSource;
}

export interface ReleasedPlanEntitlementFence {
  readonly released: boolean;
  readonly entitlement: ResolvedPlanEntitlement;
}

export interface PlanEntitlementFenceInstallTarget {
  readonly accountId: string;
  readonly planProductId: string;
  readonly ownerToken: string;
  readonly operationKey?: string;
}

export interface InstalledPlanEntitlementFence {
  readonly ownerToken: string;
  readonly entitlement: ResolvedPlanEntitlement;
}

export interface InstalledOrAdoptedPlanEntitlementFence extends InstalledPlanEntitlementFence {
  /** True only when an already-active owner was deliberately reused. */
  readonly adopted: boolean;
  /** PostgreSQL release is waiting for owner-aware Redis completion. */
  readonly releasePending: boolean;
}

export interface ResolvedPlanEntitlementFenceState {
  readonly entitlement: ResolvedPlanEntitlement;
  /** Any unreleased durable owner observed under the entitlement lock. */
  readonly activeFenceOwnerToken: string | null;
  /** A PostgreSQL release marker waiting for its Redis owner CAS. */
  readonly expiredFenceOwnerToken: string | null;
  /** An active owner whose heartbeat is stale, never auto-released by PG. */
  readonly staleFenceOwnerToken: string | null;
}

export interface PlanEntitlementReconcileTarget {
  readonly accountId: string;
  readonly planProductId: string;
  readonly ownerToken?: string;
}

export interface ReconciledPlanEntitlementFenceState extends ResolvedPlanEntitlementFenceState {
  readonly releasedFenceOwnerToken: string | null;
}

export interface RenewedPlanEntitlementFence {
  readonly accountId: string;
  readonly planProductId: string;
  readonly ownerToken: string;
}

export interface PlanEntitlementProductContext {
  readonly planProductId: string;
  readonly accountIds: string[];
}

interface EntitlementRow {
  account_id: string;
  plan_product_id: string;
  allowed: boolean;
  revision: bigint | number | string;
  valid_until: Date | string | null;
  plan_is_active: boolean;
  source: PlanEntitlementSource;
  deny_fence_token: string | null;
}

interface PlanItemContextRow {
  plan_id: string;
  plan_product_id: string;
}

interface AccountIdRow {
  account_id: string;
}

interface PotentialTestPlanEntitlementRow {
  has_potential_grant: boolean;
}

interface ProjectedPlanEntitlementRow {
  projected_allowed: boolean;
}

interface BulkFenceRow extends EntitlementRow {
  requested_owner_token: string;
  requested_operation_key: string | null;
  deny_fence_operation_key: string | null;
  deny_fence_released_at: Date | string | null;
  underlying_allowed: boolean;
}

type ReleasedFenceRow = {
  account_id: string;
  plan_product_id: string;
  owner_token: string;
  release_pending?: boolean;
};

const asBoolean = (value: unknown): boolean =>
  value === true || value === 'true' || value === 1 || value === '1';

const asIsoDate = (value: unknown): string | null => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

type DatabaseTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

@injectable()
export class PlanEntitlementRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  /** Resolves and atomically reconciles the entitlement revision on primary. */
  async resolveEntitlement(
    accountId: string,
    planProductId: string
  ): Promise<ResolvedPlanEntitlement> {
    return (
      await this.resolveEntitlementWithFenceState(accountId, planProductId)
    ).entitlement;
  }

  async resolveEntitlementWithFenceState(
    accountId: string,
    planProductId: string
  ): Promise<ResolvedPlanEntitlementFenceState> {
    return this.dbRw.transaction(async (transaction) => {
      await this.acquireEntitlementLock(transaction, accountId, planProductId);
      const fenceState = await transaction.execute<{
        owner_token: string;
        release_pending: boolean;
        heartbeat_stale: boolean;
      }>(sql`
        SELECT
          deny_fence_token::text AS owner_token,
          deny_fence_released_at IS NOT NULL AS release_pending,
          deny_fence_released_at IS NULL
            AND deny_fence_created_at <= clock_timestamp() -
              (${PLAN_ENTITLEMENT_DENY_FENCE_TTL_SECONDS} * INTERVAL '1 second')
            AS heartbeat_stale
        FROM ${accountPlanProductEntitlementRevision}
        WHERE account_id = ${accountId}::uuid
          AND plan_product_id = ${planProductId}::uuid
          AND deny_fence_token IS NOT NULL
      `);
      const entitlement = await this.resolveEntitlementInTransaction(
        transaction,
        accountId,
        planProductId
      );
      const fence = fenceState.rows[0];
      return {
        entitlement,
        activeFenceOwnerToken:
          fence && !asBoolean(fence.release_pending) ? fence.owner_token : null,
        expiredFenceOwnerToken:
          fence && asBoolean(fence.release_pending) ? fence.owner_token : null,
        staleFenceOwnerToken:
          fence && asBoolean(fence.heartbeat_stale) ? fence.owner_token : null,
      };
    });
  }

  /**
   * Installs a durable fence under the same advisory lock used by readers.
   * The fence coordinates temporary fail-closed access; revision/allowed keep
   * tracking the underlying source entitlement only.
   */
  async installDenyFence(
    accountId: string,
    planProductId: string,
    ownerToken: string
  ): Promise<ResolvedPlanEntitlement | null> {
    const installed = await this.installDenyFences([
      { accountId, planProductId, ownerToken },
    ]);
    return installed[0]?.entitlement ?? null;
  }

  /** Set-based reconciliation + durable fence install for mutation fan-out. */
  async installDenyFences(
    targets: readonly PlanEntitlementFenceInstallTarget[]
  ): Promise<InstalledPlanEntitlementFence[]> {
    const installed = await this.installDenyFencesWithPolicy(targets, false);
    return installed.map(({ ownerToken, entitlement }) => ({
      ownerToken,
      entitlement,
    }));
  }

  /**
   * Installs a fence or deliberately adopts an already-active owner.
   *
   * Adoption is intentionally exposed only as a single-target operation for
   * replaying an unfinished external revocation. Ordinary mutations must keep
   * using installDenyFence(s), which rejects an owner mismatch.
   */
  async installOrAdoptDenyFenceForRevocationRetry(
    accountId: string,
    planProductId: string,
    requestedOwnerToken: string,
    operationKey: string
  ): Promise<InstalledOrAdoptedPlanEntitlementFence | null> {
    const installed = await this.installDenyFencesWithPolicy(
      [
        {
          accountId,
          planProductId,
          ownerToken: requestedOwnerToken,
          operationKey,
        },
      ],
      true
    );
    return installed[0] ?? null;
  }

  private async installDenyFencesWithPolicy(
    targets: readonly PlanEntitlementFenceInstallTarget[],
    allowActiveOwnerAdoption: boolean
  ): Promise<InstalledOrAdoptedPlanEntitlementFence[]> {
    if (targets.length === 0) return [];
    const serializedTargets = JSON.stringify(
      targets.map((target) => ({
        account_id: target.accountId,
        plan_product_id: target.planProductId,
        owner_token: target.ownerToken,
        operation_key: target.operationKey ?? null,
      }))
    );

    return this.dbRw.transaction(async (transaction) => {
      const result = await transaction.execute(sql<BulkFenceRow>`
        WITH targets AS MATERIALIZED (
          SELECT
            account_id::uuid AS account_id,
            plan_product_id::uuid AS plan_product_id,
            owner_token::uuid AS owner_token,
            operation_key::text AS operation_key
          FROM jsonb_to_recordset(${serializedTargets}::jsonb) AS input(
            account_id text,
            plan_product_id text,
            owner_token text,
            operation_key text
          )
        ),
        locks AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(
            hashtextextended(
              account_id::text || ':' || plan_product_id::text,
              0
            )
          )
          FROM targets
          ORDER BY account_id, plan_product_id
        ),
        locked_targets AS MATERIALIZED (
          SELECT targets.*
          FROM targets
          CROSS JOIN (SELECT count(*) FROM locks) AS lock_barrier
        ),
        state AS MATERIALIZED (
          SELECT
            requested.account_id,
            requested.plan_product_id,
            requested.owner_token,
            requested.operation_key,
            latest.next_payment_date AS valid_until,
            COALESCE((
              a.account_id IS NOT NULL
              AND a.deleted_at IS NULL
              AND a.account_status_id <> ${EAccountStatus.blocked}::uuid
              AND latest.plan_account_id IS NOT NULL
              AND p.deleted_at IS NULL
              AND latest.next_payment_date > clock_timestamp()
            ), FALSE) AS plan_is_active,
            EXISTS (
              SELECT 1
              FROM ${planItems} item
              WHERE item.plan_id = latest.plan_id
                AND item.plan_product_id = requested.plan_product_id
                AND item.quantity > 0
                AND item.deleted_at IS NULL
            ) AS granted_by_plan,
            EXISTS (
              SELECT 1
              FROM ${planCrossSellAccount} assignment
              INNER JOIN ${planCrossSell} addon
                ON addon.plan_cross_sell_id = assignment.plan_cross_sell_id
              WHERE assignment.account_id = requested.account_id
                AND assignment.deleted_at IS NULL
                AND addon.deleted_at IS NULL
                AND addon.plan_product_id = requested.plan_product_id
                AND addon.quantity > 0
                AND (
                  assignment.cancellation_date IS NULL
                  OR latest.last_payment_date IS NULL
                  OR assignment.cancellation_date >= latest.last_payment_date
                )
            ) AS granted_by_addon
          FROM locked_targets requested
          LEFT JOIN ${account} a ON a.account_id = requested.account_id
          LEFT JOIN LATERAL (
            SELECT
              pa.plan_account_id,
              pa.plan_id,
              pa.last_payment_date,
              pa.next_payment_date
            FROM ${planAccount} pa
            WHERE pa.account_id = requested.account_id
            ORDER BY
              pa.updated_at DESC NULLS LAST,
              pa.created_at DESC NULLS LAST,
              pa.plan_account_id DESC
            LIMIT 1
          ) latest ON TRUE
          LEFT JOIN ${plan} p ON p.plan_id = latest.plan_id
        ),
        resolved AS MATERIALIZED (
          SELECT
            state.*,
            COALESCE(
              plan_is_active AND (granted_by_plan OR granted_by_addon),
              FALSE
            ) AS underlying_allowed,
            CASE
              WHEN plan_is_active AND granted_by_plan THEN 'plan'::text
              WHEN plan_is_active AND granted_by_addon THEN 'addon'::text
              ELSE NULL::text
            END AS source
          FROM state
        ),
        upserted AS (
          INSERT INTO ${accountPlanProductEntitlementRevision} AS persisted (
            account_id,
            plan_product_id,
            revision,
            allowed,
            deny_fence_token,
            deny_fence_created_at,
            deny_fence_released_at,
            deny_fence_operation_key,
            updated_at
          )
          SELECT
            account_id,
            plan_product_id,
            1,
            underlying_allowed,
            CASE WHEN underlying_allowed THEN owner_token ELSE NULL END,
            CASE WHEN underlying_allowed THEN clock_timestamp() ELSE NULL END,
            NULL,
            CASE WHEN underlying_allowed THEN operation_key ELSE NULL END,
            clock_timestamp()
          FROM resolved
          ON CONFLICT (account_id, plan_product_id) DO UPDATE
          SET
            revision = CASE
              WHEN persisted.allowed IS DISTINCT FROM EXCLUDED.allowed
                THEN persisted.revision + 1
              ELSE persisted.revision
            END,
            allowed = EXCLUDED.allowed,
            deny_fence_token = CASE
              WHEN persisted.deny_fence_token IS NOT NULL
                THEN persisted.deny_fence_token
              WHEN EXCLUDED.allowed THEN EXCLUDED.deny_fence_token
              ELSE NULL
            END,
            deny_fence_created_at = CASE
              WHEN persisted.deny_fence_token IS NOT NULL
                THEN persisted.deny_fence_created_at
              WHEN EXCLUDED.allowed THEN EXCLUDED.deny_fence_created_at
              ELSE NULL
            END,
            deny_fence_released_at = CASE
              WHEN persisted.deny_fence_token IS NOT NULL
                THEN persisted.deny_fence_released_at
              ELSE NULL
            END,
            deny_fence_operation_key = CASE
              WHEN persisted.deny_fence_token IS NOT NULL
                THEN persisted.deny_fence_operation_key
              WHEN EXCLUDED.allowed THEN EXCLUDED.deny_fence_operation_key
              ELSE NULL
            END,
            updated_at = CASE
              WHEN persisted.allowed IS DISTINCT FROM EXCLUDED.allowed
                THEN clock_timestamp()
              ELSE persisted.updated_at
            END
          RETURNING
            account_id,
            plan_product_id,
            revision,
            allowed,
            deny_fence_token,
            deny_fence_operation_key,
            deny_fence_released_at
        )
        SELECT
          resolved.account_id,
          resolved.plan_product_id,
          CASE
            WHEN upserted.deny_fence_released_at IS NULL THEN FALSE
            ELSE resolved.underlying_allowed
          END AS allowed,
          upserted.revision,
          CASE
            WHEN resolved.plan_is_active THEN resolved.valid_until
            ELSE NULL
          END AS valid_until,
          resolved.plan_is_active,
          CASE
            WHEN upserted.deny_fence_released_at IS NULL THEN NULL::text
            ELSE resolved.source
          END AS source,
          upserted.deny_fence_token,
          upserted.deny_fence_operation_key,
          upserted.deny_fence_released_at,
          resolved.owner_token AS requested_owner_token,
          resolved.operation_key AS requested_operation_key,
          resolved.underlying_allowed
        FROM resolved
        INNER JOIN upserted
          ON upserted.account_id = resolved.account_id
          AND upserted.plan_product_id = resolved.plan_product_id
      `);

      const installed: InstalledOrAdoptedPlanEntitlementFence[] = [];
      for (const row of result.rows) {
        const hasActiveOwner = row.deny_fence_token !== null;
        if (!asBoolean(row.underlying_allowed)) {
          // A retry must still adopt and finalize the owner when the local
          // revocation committed but its post-commit cache reconciliation did
          // not. Ordinary installs keep treating denied targets as no-ops.
          if (!allowActiveOwnerAdoption || !hasActiveOwner) continue;
        }
        const activeOwnerToken = String(row.deny_fence_token);
        const requestedOwnerToken = String(row.requested_owner_token);
        const adopted = activeOwnerToken !== requestedOwnerToken;
        if (
          adopted &&
          allowActiveOwnerAdoption &&
          (row.requested_operation_key === null ||
            row.deny_fence_operation_key !== row.requested_operation_key)
        ) {
          throw new Error('plan_entitlement_deny_fence_operation_key_mismatch');
        }
        if (adopted && !allowActiveOwnerAdoption) {
          throw new Error('plan_entitlement_deny_fence_already_owned');
        }
        installed.push({
          ownerToken: activeOwnerToken,
          entitlement: this.mapEntitlementRow(row),
          adopted,
          releasePending:
            row.deny_fence_released_at !== null &&
            row.deny_fence_released_at !== undefined,
        });
      }
      return installed;
    });
  }

  /** Renews only caller-owned, unreleased fences in one owner-CAS UPDATE. */
  async heartbeatDenyFences(
    targets: readonly PlanEntitlementFenceInstallTarget[]
  ): Promise<RenewedPlanEntitlementFence[]> {
    if (targets.length === 0) return [];
    const serializedTargets = JSON.stringify(
      targets.map((target) => ({
        account_id: target.accountId,
        plan_product_id: target.planProductId,
        owner_token: target.ownerToken,
      }))
    );
    const renewed = await this.dbRw.execute<ReleasedFenceRow>(sql`
      WITH requested AS MATERIALIZED (
        SELECT
          account_id::uuid AS account_id,
          plan_product_id::uuid AS plan_product_id,
          owner_token::uuid AS owner_token
        FROM jsonb_to_recordset(${serializedTargets}::jsonb) AS input(
          account_id text,
          plan_product_id text,
          owner_token text
        )
      )
      UPDATE ${accountPlanProductEntitlementRevision} AS persisted
      SET deny_fence_created_at = clock_timestamp()
      FROM requested
      WHERE persisted.account_id = requested.account_id
        AND persisted.plan_product_id = requested.plan_product_id
        AND persisted.deny_fence_token = requested.owner_token
        AND persisted.deny_fence_released_at IS NULL
      RETURNING
        persisted.account_id,
        persisted.plan_product_id,
        persisted.deny_fence_token::text AS owner_token
    `);
    return renewed.rows.map((row) => ({
      accountId: String(row.account_id),
      planProductId: String(row.plan_product_id),
      ownerToken: String(row.owner_token),
    }));
  }

  /** Clears only the caller-owned fence and then reconciles current sources. */
  async releaseDenyFence(
    accountId: string,
    planProductId: string,
    ownerToken: string
  ): Promise<ReleasedPlanEntitlementFence> {
    return this.dbRw.transaction(async (transaction) => {
      await this.acquireEntitlementLock(transaction, accountId, planProductId);
      const cleared = await transaction.execute(sql<{ released: boolean }>`
        UPDATE ${accountPlanProductEntitlementRevision}
        SET
          deny_fence_released_at = COALESCE(
            deny_fence_released_at,
            clock_timestamp()
          )
        WHERE account_id = ${accountId}::uuid
          AND plan_product_id = ${planProductId}::uuid
          AND deny_fence_token = ${ownerToken}::uuid
        RETURNING TRUE AS released
      `);
      const entitlement = await this.resolveEntitlementInTransaction(
        transaction,
        accountId,
        planProductId
      );
      return {
        released: asBoolean(cleared.rows[0]?.released),
        entitlement,
      };
    });
  }

  /** Releases an orphan only if its PG heartbeat is still stale under lock. */
  async releaseStaleDenyFence(
    accountId: string,
    planProductId: string,
    ownerToken: string
  ): Promise<ReleasedPlanEntitlementFence> {
    return this.dbRw.transaction(async (transaction) => {
      await this.acquireEntitlementLock(transaction, accountId, planProductId);
      const released = await transaction.execute<{ released: boolean }>(sql`
        UPDATE ${accountPlanProductEntitlementRevision}
        SET deny_fence_released_at = clock_timestamp()
        WHERE account_id = ${accountId}::uuid
          AND plan_product_id = ${planProductId}::uuid
          AND deny_fence_token = ${ownerToken}::uuid
          AND deny_fence_released_at IS NULL
          AND deny_fence_created_at <= clock_timestamp() -
            (${PLAN_ENTITLEMENT_DENY_FENCE_TTL_SECONDS} * INTERVAL '1 second')
        RETURNING TRUE AS released
      `);
      const entitlement = await this.resolveEntitlementInTransaction(
        transaction,
        accountId,
        planProductId
      );
      return {
        released: asBoolean(released.rows[0]?.released),
        entitlement,
      };
    });
  }

  async finalizeReleasedDenyFence(
    accountId: string,
    planProductId: string,
    ownerToken: string
  ): Promise<void> {
    await this.dbRw.execute(sql`
      UPDATE ${accountPlanProductEntitlementRevision}
      SET
        deny_fence_token = NULL,
        deny_fence_created_at = NULL,
        deny_fence_released_at = NULL,
        deny_fence_operation_key = NULL
      WHERE account_id = ${accountId}::uuid
        AND plan_product_id = ${planProductId}::uuid
        AND deny_fence_token = ${ownerToken}::uuid
        AND deny_fence_released_at IS NOT NULL
    `);
  }

  async finalizeReleasedDenyFenceForOperation(
    accountId: string,
    planProductId: string,
    ownerToken: string,
    operationKey: string
  ): Promise<boolean> {
    const finalized = await this.dbRw.execute<{ finalized: boolean }>(sql`
      UPDATE ${accountPlanProductEntitlementRevision}
      SET
        deny_fence_token = NULL,
        deny_fence_created_at = NULL,
        deny_fence_released_at = NULL,
        deny_fence_operation_key = NULL
      WHERE account_id = ${accountId}::uuid
        AND plan_product_id = ${planProductId}::uuid
        AND deny_fence_token = ${ownerToken}::uuid
        AND deny_fence_released_at IS NOT NULL
        AND deny_fence_operation_key = ${operationKey}
      RETURNING TRUE AS finalized
    `);
    return asBoolean(finalized.rows[0]?.finalized);
  }

  async finalizeReleasedDenyFences(
    targets: readonly PlanEntitlementFenceInstallTarget[]
  ): Promise<void> {
    if (targets.length === 0) return;
    const serializedTargets = JSON.stringify(
      targets.map((target) => ({
        account_id: target.accountId,
        plan_product_id: target.planProductId,
        owner_token: target.ownerToken,
      }))
    );
    await this.dbRw.execute(sql`
      WITH requested AS MATERIALIZED (
        SELECT
          account_id::uuid AS account_id,
          plan_product_id::uuid AS plan_product_id,
          owner_token::uuid AS owner_token
        FROM jsonb_to_recordset(${serializedTargets}::jsonb) AS input(
          account_id text,
          plan_product_id text,
          owner_token text
        )
      )
      UPDATE ${accountPlanProductEntitlementRevision} AS persisted
      SET
        deny_fence_token = NULL,
        deny_fence_created_at = NULL,
        deny_fence_released_at = NULL,
        deny_fence_operation_key = NULL
      FROM requested
      WHERE persisted.account_id = requested.account_id
        AND persisted.plan_product_id = requested.plan_product_id
        AND persisted.deny_fence_token = requested.owner_token
        AND persisted.deny_fence_released_at IS NOT NULL
    `);
  }

  /**
   * Reconciles a fan-out in three set-based statements: ordered locks, owner /
   * expiry CAS release, and one authoritative UPSERT query.
   */
  async reconcileEntitlements(
    targets: readonly PlanEntitlementReconcileTarget[]
  ): Promise<ReconciledPlanEntitlementFenceState[]> {
    if (targets.length === 0) return [];
    const serializedTargets = JSON.stringify(
      targets.map((target) => ({
        account_id: target.accountId,
        plan_product_id: target.planProductId,
        owner_token: target.ownerToken ?? null,
      }))
    );

    return this.dbRw.transaction(async (transaction) => {
      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(ordered.lock_key)
        FROM (
          SELECT hashtextextended(
            input.account_id::uuid::text || ':' ||
              input.plan_product_id::uuid::text,
            0
          ) AS lock_key
          FROM jsonb_to_recordset(${serializedTargets}::jsonb) AS input(
            account_id text,
            plan_product_id text,
            owner_token text
          )
          ORDER BY
            input.account_id::uuid,
            input.plan_product_id::uuid
        ) ordered
      `);

      const releasedOwners = await transaction.execute<ReleasedFenceRow>(sql`
        WITH requested AS MATERIALIZED (
          SELECT
            account_id::uuid AS account_id,
            plan_product_id::uuid AS plan_product_id,
            owner_token::uuid AS owner_token
          FROM jsonb_to_recordset(${serializedTargets}::jsonb) AS input(
            account_id text,
            plan_product_id text,
            owner_token text
          )
          WHERE owner_token IS NOT NULL
        )
        UPDATE ${accountPlanProductEntitlementRevision} AS persisted
        SET
          deny_fence_released_at = COALESCE(
            deny_fence_released_at,
            clock_timestamp()
          )
        FROM requested
        WHERE persisted.account_id = requested.account_id
          AND persisted.plan_product_id = requested.plan_product_id
          AND persisted.deny_fence_token = requested.owner_token
        RETURNING
          persisted.account_id,
          persisted.plan_product_id,
          requested.owner_token::text AS owner_token
      `);

      const pendingOrStaleOwners =
        await transaction.execute<ReleasedFenceRow>(sql`
        WITH requested AS MATERIALIZED (
          SELECT
            account_id::uuid AS account_id,
            plan_product_id::uuid AS plan_product_id
          FROM jsonb_to_recordset(${serializedTargets}::jsonb) AS input(
            account_id text,
            plan_product_id text,
            owner_token text
          )
        )
        SELECT
          persisted.account_id,
          persisted.plan_product_id,
          persisted.deny_fence_token::text AS owner_token,
          persisted.deny_fence_released_at IS NOT NULL AS release_pending
        FROM ${accountPlanProductEntitlementRevision} persisted
        INNER JOIN requested
          ON requested.account_id = persisted.account_id
          AND requested.plan_product_id = persisted.plan_product_id
        WHERE persisted.deny_fence_token IS NOT NULL
          AND (
            persisted.deny_fence_released_at IS NOT NULL
            OR persisted.deny_fence_created_at <= clock_timestamp() -
              (${PLAN_ENTITLEMENT_DENY_FENCE_TTL_SECONDS} * INTERVAL '1 second')
          )
      `);

      const result = await transaction.execute(sql<EntitlementRow>`
        WITH requested AS MATERIALIZED (
          SELECT
            account_id::uuid AS account_id,
            plan_product_id::uuid AS plan_product_id
          FROM jsonb_to_recordset(${serializedTargets}::jsonb) AS input(
            account_id text,
            plan_product_id text,
            owner_token text
          )
        ),
        state AS MATERIALIZED (
          SELECT
            requested.account_id,
            requested.plan_product_id,
            latest.next_payment_date AS valid_until,
            COALESCE((
              a.account_id IS NOT NULL
              AND a.deleted_at IS NULL
              AND a.account_status_id <> ${EAccountStatus.blocked}::uuid
              AND latest.plan_account_id IS NOT NULL
              AND p.deleted_at IS NULL
              AND latest.next_payment_date > clock_timestamp()
            ), FALSE) AS plan_is_active,
            EXISTS (
              SELECT 1
              FROM ${planItems} item
              WHERE item.plan_id = latest.plan_id
                AND item.plan_product_id = requested.plan_product_id
                AND item.quantity > 0
                AND item.deleted_at IS NULL
            ) AS granted_by_plan,
            EXISTS (
              SELECT 1
              FROM ${planCrossSellAccount} assignment
              INNER JOIN ${planCrossSell} addon
                ON addon.plan_cross_sell_id = assignment.plan_cross_sell_id
              WHERE assignment.account_id = requested.account_id
                AND assignment.deleted_at IS NULL
                AND addon.deleted_at IS NULL
                AND addon.plan_product_id = requested.plan_product_id
                AND addon.quantity > 0
                AND (
                  assignment.cancellation_date IS NULL
                  OR latest.last_payment_date IS NULL
                  OR assignment.cancellation_date >= latest.last_payment_date
                )
            ) AS granted_by_addon
          FROM requested
          LEFT JOIN ${account} a ON a.account_id = requested.account_id
          LEFT JOIN LATERAL (
            SELECT
              pa.plan_account_id,
              pa.plan_id,
              pa.last_payment_date,
              pa.next_payment_date
            FROM ${planAccount} pa
            WHERE pa.account_id = requested.account_id
            ORDER BY
              pa.updated_at DESC NULLS LAST,
              pa.created_at DESC NULLS LAST,
              pa.plan_account_id DESC
            LIMIT 1
          ) latest ON TRUE
          LEFT JOIN ${plan} p ON p.plan_id = latest.plan_id
        ),
        resolved AS MATERIALIZED (
          SELECT
            state.account_id,
            state.plan_product_id,
            COALESCE(
              state.plan_is_active AND
                (state.granted_by_plan OR state.granted_by_addon),
              FALSE
            ) AS underlying_allowed,
            CASE
              WHEN state.plan_is_active THEN state.valid_until
              ELSE NULL
            END AS valid_until,
            state.plan_is_active,
            CASE
              WHEN state.plan_is_active AND state.granted_by_plan
                THEN 'plan'::text
              WHEN state.plan_is_active AND state.granted_by_addon
                THEN 'addon'::text
              ELSE NULL::text
            END AS source
          FROM state
        ),
        effective AS MATERIALIZED (
          SELECT
            resolved.account_id,
            resolved.plan_product_id,
            resolved.underlying_allowed
              AND (
                persisted.deny_fence_token IS NULL
                OR persisted.deny_fence_released_at IS NOT NULL
              ) AS allowed,
            resolved.valid_until,
            resolved.plan_is_active,
            CASE
              WHEN persisted.deny_fence_token IS NULL
                OR persisted.deny_fence_released_at IS NOT NULL
                THEN resolved.source
              ELSE NULL::text
            END AS source
          FROM resolved
          LEFT JOIN ${accountPlanProductEntitlementRevision} persisted
            ON persisted.account_id = resolved.account_id
            AND persisted.plan_product_id = resolved.plan_product_id
        ),
        reconciled AS (
          INSERT INTO ${accountPlanProductEntitlementRevision} AS persisted (
            account_id,
            plan_product_id,
            revision,
            allowed,
            updated_at
          )
          SELECT
            account_id,
            plan_product_id,
            1,
            underlying_allowed,
            clock_timestamp()
          FROM resolved
          ON CONFLICT (account_id, plan_product_id) DO UPDATE
          SET
            revision = CASE
              WHEN persisted.allowed IS DISTINCT FROM EXCLUDED.allowed
                THEN persisted.revision + 1
              ELSE persisted.revision
            END,
            allowed = EXCLUDED.allowed,
            updated_at = CASE
              WHEN persisted.allowed IS DISTINCT FROM EXCLUDED.allowed
                THEN clock_timestamp()
              ELSE persisted.updated_at
            END
          RETURNING account_id, plan_product_id, revision
        )
        SELECT
          effective.account_id,
          effective.plan_product_id,
          effective.allowed,
          reconciled.revision,
          effective.valid_until,
          effective.plan_is_active,
          effective.source,
          NULL::uuid AS deny_fence_token
        FROM effective
        INNER JOIN reconciled
          ON reconciled.account_id = effective.account_id
          AND reconciled.plan_product_id = effective.plan_product_id
      `);

      const releasedByTarget = new Map(
        releasedOwners.rows.map((row) => [
          `${row.account_id}:${row.plan_product_id}`,
          row.owner_token,
        ])
      );
      const pendingByTarget = new Map(
        pendingOrStaleOwners.rows
          .filter((row) => asBoolean(row.release_pending))
          .map((row) => [
            `${row.account_id}:${row.plan_product_id}`,
            row.owner_token,
          ])
      );
      const staleByTarget = new Map(
        pendingOrStaleOwners.rows
          .filter((row) => !asBoolean(row.release_pending))
          .map((row) => [
            `${row.account_id}:${row.plan_product_id}`,
            row.owner_token,
          ])
      );
      return result.rows.map((row) => {
        const key = `${row.account_id}:${row.plan_product_id}`;
        return {
          entitlement: this.mapEntitlementRow(row),
          activeFenceOwnerToken: null,
          releasedFenceOwnerToken: releasedByTarget.get(key) ?? null,
          expiredFenceOwnerToken: pendingByTarget.get(key) ?? null,
          staleFenceOwnerToken: staleByTarget.get(key) ?? null,
        };
      });
    });
  }

  private async acquireEntitlementLock(
    transaction: DatabaseTransaction,
    accountId: string,
    planProductId: string
  ): Promise<void> {
    // A single bigint lock key has deterministic cross-process semantics. A
    // hash collision can only add harmless serialization, never weaken safety.
    await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${accountId}:${planProductId}`}, 0)
      )
    `);
  }

  private async resolveEntitlementInTransaction(
    transaction: DatabaseTransaction,
    accountId: string,
    planProductId: string
  ): Promise<ResolvedPlanEntitlement> {
    const query = sql<EntitlementRow>`
      WITH latest_plan AS (
        SELECT
          pa.account_id,
          pa.plan_account_id,
          pa.plan_id,
          pa.last_payment_date,
          pa.next_payment_date
        FROM ${planAccount} pa
        WHERE pa.account_id = ${accountId}::uuid
        ORDER BY
          pa.updated_at DESC NULLS LAST,
          pa.created_at DESC NULLS LAST,
          pa.plan_account_id DESC
        LIMIT 1
      ),
      entitlement_state AS (
        SELECT
          ${accountId}::uuid AS account_id,
          ${planProductId}::uuid AS plan_product_id,
          lp.next_payment_date AS valid_until,
          COALESCE((
            a.account_id IS NOT NULL
            AND a.deleted_at IS NULL
            AND a.account_status_id <> ${EAccountStatus.blocked}::uuid
            AND lp.plan_account_id IS NOT NULL
            AND p.deleted_at IS NULL
            AND lp.next_payment_date > NOW()
          ), FALSE) AS plan_is_active,
          EXISTS (
            SELECT 1
            FROM ${planItems} pi
            WHERE pi.plan_id = lp.plan_id
              AND pi.plan_product_id = ${planProductId}::uuid
              AND pi.quantity > 0
              AND pi.deleted_at IS NULL
          ) AS granted_by_plan,
          EXISTS (
            SELECT 1
            FROM ${planCrossSellAccount} pcsa
            INNER JOIN ${planCrossSell} pcs
              ON pcs.plan_cross_sell_id = pcsa.plan_cross_sell_id
            WHERE pcsa.account_id = ${accountId}::uuid
              AND pcsa.deleted_at IS NULL
              AND pcs.deleted_at IS NULL
              AND pcs.plan_product_id = ${planProductId}::uuid
              AND pcs.quantity > 0
              AND (
                pcsa.cancellation_date IS NULL
                OR lp.last_payment_date IS NULL
                OR pcsa.cancellation_date >= lp.last_payment_date
              )
          ) AS granted_by_addon
        FROM (SELECT 1) requested
        LEFT JOIN ${account} a ON a.account_id = ${accountId}::uuid
        LEFT JOIN latest_plan lp ON lp.account_id = a.account_id
        LEFT JOIN ${plan} p ON p.plan_id = lp.plan_id
      ),
      resolved AS (
        SELECT
          account_id,
          plan_product_id,
          COALESCE(
            plan_is_active AND (granted_by_plan OR granted_by_addon),
            FALSE
          ) AS underlying_allowed,
          CASE WHEN plan_is_active THEN valid_until ELSE NULL END AS valid_until,
          plan_is_active,
          CASE
            WHEN plan_is_active AND granted_by_plan THEN 'plan'::text
            WHEN plan_is_active AND granted_by_addon THEN 'addon'::text
            ELSE NULL::text
          END AS source
        FROM entitlement_state
      ),
      effective AS (
        SELECT
          resolved.account_id,
          resolved.plan_product_id,
          resolved.underlying_allowed
            AND (
              persisted.deny_fence_token IS NULL
              OR persisted.deny_fence_released_at IS NOT NULL
            ) AS allowed,
          resolved.valid_until,
          resolved.plan_is_active,
          CASE
            WHEN persisted.deny_fence_token IS NOT NULL
              AND persisted.deny_fence_released_at IS NULL
              THEN NULL::text
            ELSE resolved.source
          END AS source
        FROM resolved
        LEFT JOIN ${accountPlanProductEntitlementRevision} AS persisted
          ON persisted.account_id = resolved.account_id
          AND persisted.plan_product_id = resolved.plan_product_id
      ),
      revision AS (
        INSERT INTO ${accountPlanProductEntitlementRevision} AS entitlement_revision (
          account_id,
          plan_product_id,
          revision,
          allowed,
          updated_at
        )
        SELECT
          account_id,
          plan_product_id,
          1,
          underlying_allowed,
          NOW()
        FROM resolved
        ON CONFLICT (account_id, plan_product_id) DO UPDATE
        SET
          revision = CASE
            WHEN entitlement_revision.allowed IS DISTINCT FROM EXCLUDED.allowed
              THEN entitlement_revision.revision + 1
            ELSE entitlement_revision.revision
          END,
          allowed = EXCLUDED.allowed,
          updated_at = CASE
            WHEN entitlement_revision.allowed IS DISTINCT FROM EXCLUDED.allowed
              THEN NOW()
            ELSE entitlement_revision.updated_at
          END
        RETURNING revision, deny_fence_token
      )
      SELECT
        effective.account_id,
        effective.plan_product_id,
        effective.allowed,
        revision.revision,
        effective.valid_until,
        effective.plan_is_active,
        effective.source,
        revision.deny_fence_token
      FROM effective
      CROSS JOIN revision
    `;

    const result = await transaction.execute(query);
    return this.mapEntitlementRow(result.rows[0]);
  }

  private mapEntitlementRow(row: unknown): ResolvedPlanEntitlement {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('plan_entitlement_resolution_returned_no_rows');
    }
    const value = row as Record<string, unknown>;
    if (!value.account_id || !value.plan_product_id || !value.revision) {
      throw new Error('plan_entitlement_resolution_returned_invalid_row');
    }
    const allowed = asBoolean(value.allowed);
    const source =
      value.source === 'plan' || value.source === 'addon'
        ? value.source
        : value.source === null
          ? null
          : undefined;
    const validUntil = asIsoDate(value.valid_until);
    const planIsActive = asBoolean(value.plan_is_active);
    if (
      source === undefined ||
      (allowed && source === null) ||
      (!allowed && source !== null) ||
      (allowed && validUntil === null) ||
      (allowed && !planIsActive)
    ) {
      throw new Error('plan_entitlement_resolution_returned_invalid_source');
    }
    return {
      accountId: String(value.account_id),
      planProductId: String(value.plan_product_id),
      allowed,
      revision: String(value.revision),
      validUntil,
      planIsActive,
      source,
    };
  }

  async listCurrentAccountIdsByPlan(planId: string): Promise<string[]> {
    const result = await this.dbRw.execute(sql<AccountIdRow>`
      WITH current_plans AS (
        SELECT DISTINCT ON (pa.account_id)
          pa.account_id,
          pa.plan_id
        FROM ${planAccount} pa
        ORDER BY
          pa.account_id,
          pa.updated_at DESC NULLS LAST,
          pa.created_at DESC NULLS LAST,
          pa.plan_account_id DESC
      )
      SELECT account_id
      FROM current_plans
      WHERE plan_id = ${planId}::uuid
    `);

    return result.rows.map((row) => String(row.account_id));
  }

  /** Accounts for which deleting this exact plan item removes the last grant. */
  async listAccountIdsRevokedByPlanItemRemoval(
    planItemId: string
  ): Promise<string[]> {
    const result = await this.dbRw.execute(sql<AccountIdRow>`
      WITH item AS (
        SELECT plan_item_id, plan_id, plan_product_id
        FROM ${planItems}
        WHERE plan_item_id = ${planItemId}::uuid
      ),
      current_plans AS (
        SELECT DISTINCT ON (pa.account_id)
          pa.account_id,
          pa.plan_id,
          pa.last_payment_date
        FROM ${planAccount} pa
        ORDER BY
          pa.account_id,
          pa.updated_at DESC NULLS LAST,
          pa.created_at DESC NULLS LAST,
          pa.plan_account_id DESC
      )
      SELECT cp.account_id
      FROM current_plans cp
      INNER JOIN item ON item.plan_id = cp.plan_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM ${planItems} alternative_item
        WHERE alternative_item.plan_id = item.plan_id
          AND alternative_item.plan_product_id = item.plan_product_id
          AND alternative_item.plan_item_id <> item.plan_item_id
          AND alternative_item.quantity > 0
          AND alternative_item.deleted_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM ${planCrossSellAccount} alternative_account
        INNER JOIN ${planCrossSell} alternative
          ON alternative.plan_cross_sell_id =
            alternative_account.plan_cross_sell_id
        WHERE alternative_account.account_id = cp.account_id
          AND alternative_account.deleted_at IS NULL
          AND alternative.deleted_at IS NULL
          AND alternative.plan_product_id = item.plan_product_id
          AND alternative.quantity > 0
          AND (
            alternative_account.cancellation_date IS NULL
            OR cp.last_payment_date IS NULL
            OR alternative_account.cancellation_date >= cp.last_payment_date
          )
      )
    `);
    return result.rows.map((row) => String(row.account_id));
  }

  /** Accounts for which removing a catalog add-on removes the last grant. */
  async listAccountIdsRevokedByCrossSellRemoval(
    planCrossSellId: string
  ): Promise<string[]> {
    const result = await this.dbRw.execute(sql<AccountIdRow>`
      WITH selected AS (
        SELECT plan_cross_sell_id, plan_product_id
        FROM ${planCrossSell}
        WHERE plan_cross_sell_id = ${planCrossSellId}::uuid
      ),
      current_plans AS (
        SELECT DISTINCT ON (pa.account_id)
          pa.account_id,
          pa.plan_id,
          pa.last_payment_date
        FROM ${planAccount} pa
        ORDER BY
          pa.account_id,
          pa.updated_at DESC NULLS LAST,
          pa.created_at DESC NULLS LAST,
          pa.plan_account_id DESC
      )
      SELECT DISTINCT assignment.account_id
      FROM selected
      INNER JOIN ${planCrossSellAccount} assignment
        ON assignment.plan_cross_sell_id = selected.plan_cross_sell_id
        AND assignment.deleted_at IS NULL
      INNER JOIN current_plans cp ON cp.account_id = assignment.account_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM ${planItems} plan_grant
        WHERE plan_grant.plan_id = cp.plan_id
          AND plan_grant.plan_product_id = selected.plan_product_id
          AND plan_grant.quantity > 0
          AND plan_grant.deleted_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM ${planCrossSellAccount} alternative_account
        INNER JOIN ${planCrossSell} alternative
          ON alternative.plan_cross_sell_id =
            alternative_account.plan_cross_sell_id
        WHERE alternative_account.account_id = assignment.account_id
          AND alternative_account.plan_cross_sell_id <>
            selected.plan_cross_sell_id
          AND alternative_account.deleted_at IS NULL
          AND alternative.deleted_at IS NULL
          AND alternative.plan_product_id = selected.plan_product_id
          AND alternative.quantity > 0
          AND (
            alternative_account.cancellation_date IS NULL
            OR cp.last_payment_date IS NULL
            OR alternative_account.cancellation_date >= cp.last_payment_date
          )
      )
    `);
    return result.rows.map((row) => String(row.account_id));
  }

  /** Whether deleting one account add-on assignment removes its last grant. */
  async isAccountRevokedByCrossSellAccountRemoval(
    planCrossSellAccountId: string
  ): Promise<boolean> {
    const context = await this.findCrossSellAccountContext(
      planCrossSellAccountId
    );
    if (!context) return false;
    const impacted = await this.listAccountIdsRevokedByCrossSellRemoval(
      context.planCrossSellId
    );
    if (!impacted.includes(context.accountId)) return false;

    // The catalog-level query excludes every assignment for the same offer;
    // preserve access if this account has a duplicate active assignment.
    const duplicate = await this.dbRw.execute(sql<{ exists: boolean }>`
      WITH latest_plan AS (
        SELECT last_payment_date
        FROM ${planAccount}
        WHERE account_id = ${context.accountId}::uuid
        ORDER BY
          updated_at DESC NULLS LAST,
          created_at DESC NULLS LAST,
          plan_account_id DESC
        LIMIT 1
      )
      SELECT EXISTS (
        SELECT 1
        FROM ${planCrossSellAccount}
        CROSS JOIN latest_plan
        WHERE account_id = ${context.accountId}::uuid
          AND plan_cross_sell_id = ${context.planCrossSellId}::uuid
          AND plan_cross_sell_account_id <> ${planCrossSellAccountId}::uuid
          AND deleted_at IS NULL
          AND (
            cancellation_date IS NULL
            OR latest_plan.last_payment_date IS NULL
            OR cancellation_date >= latest_plan.last_payment_date
          )
      ) AS exists
    `);
    return !asBoolean(duplicate.rows[0]?.exists);
  }

  async hasPotentialGrantAfterTestPlanActivation(
    accountId: string,
    planId: string,
    planProductId: string
  ): Promise<boolean> {
    const result = await this.dbRw.execute(
      sql<PotentialTestPlanEntitlementRow>`
        SELECT (
          EXISTS (
            SELECT 1
            FROM ${account} a
            INNER JOIN ${plan} p
              ON p.plan_id = ${planId}::uuid
            INNER JOIN ${planItems} pi
              ON pi.plan_id = p.plan_id
            WHERE a.account_id = ${accountId}::uuid
              AND a.deleted_at IS NULL
              AND p.deleted_at IS NULL
              AND p.status = ${EPlanStatus.active}
              AND pi.plan_product_id = ${planProductId}::uuid
              AND pi.quantity > 0
              AND pi.deleted_at IS NULL
          )
          OR EXISTS (
            SELECT 1
            FROM ${account} a
            INNER JOIN ${planCrossSellAccount} pcsa
              ON pcsa.account_id = a.account_id
            INNER JOIN ${planCrossSell} pcs
              ON pcs.plan_cross_sell_id = pcsa.plan_cross_sell_id
            WHERE a.account_id = ${accountId}::uuid
              AND a.deleted_at IS NULL
              AND pcsa.deleted_at IS NULL
              AND pcs.deleted_at IS NULL
              AND pcs.plan_product_id = ${planProductId}::uuid
              AND pcs.quantity > 0
          )
        ) AS has_potential_grant
      `
    );

    return asBoolean(result.rows[0]?.has_potential_grant);
  }

  async willGrantAfterPlanAssignment(input: {
    accountId: string;
    planId: string;
    planProductId: string;
    prospectiveLastPaymentDate: string | null;
    includeExistingAddons: boolean;
    prospectiveAccountPaymentId?: string;
  }): Promise<boolean> {
    const result = await this.dbRw.execute(sql<ProjectedPlanEntitlementRow>`
      SELECT COALESCE((
        a.account_id IS NOT NULL
        AND a.deleted_at IS NULL
        AND a.account_status_id <> ${EAccountStatus.blocked}::uuid
        AND p.plan_id IS NOT NULL
        AND p.deleted_at IS NULL
        AND p.status = ${EPlanStatus.active}
        AND (
          EXISTS (
            SELECT 1
            FROM ${planItems} item
            WHERE item.plan_id = p.plan_id
              AND item.plan_product_id = ${input.planProductId}::uuid
              AND item.quantity > 0
              AND item.deleted_at IS NULL
          )
          OR (
            ${input.includeExistingAddons}
            AND EXISTS (
              SELECT 1
              FROM ${planCrossSellAccount} assignment
              INNER JOIN ${planCrossSell} addon
                ON addon.plan_cross_sell_id = assignment.plan_cross_sell_id
              WHERE assignment.account_id = ${input.accountId}::uuid
                AND assignment.deleted_at IS NULL
                AND addon.deleted_at IS NULL
                AND addon.plan_product_id = ${input.planProductId}::uuid
                AND addon.quantity > 0
                AND (
                  assignment.cancellation_date IS NULL
                  OR ${input.prospectiveLastPaymentDate}::timestamptz IS NULL
                  OR assignment.cancellation_date >=
                    ${input.prospectiveLastPaymentDate}::timestamptz
                )
            )
          )
          OR (
            ${input.prospectiveAccountPaymentId ?? null}::uuid IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM ${accountPaymentCrossSell} purchased
              INNER JOIN ${planCrossSell} addon
                ON addon.plan_cross_sell_id = purchased.plan_cross_sell_id
              WHERE purchased.account_payment_id =
                ${input.prospectiveAccountPaymentId ?? null}::uuid
                AND purchased.quantity > 0
                AND addon.deleted_at IS NULL
                AND addon.plan_product_id = ${input.planProductId}::uuid
                AND addon.quantity > 0
            )
          )
        )
      ), FALSE) AS projected_allowed
      FROM (SELECT 1) requested
      LEFT JOIN ${account} a
        ON a.account_id = ${input.accountId}::uuid
      LEFT JOIN ${plan} p
        ON p.plan_id = ${input.planId}::uuid
    `);
    return asBoolean(result.rows[0]?.projected_allowed);
  }

  async findPlanItemContext(
    planItemId: string
  ): Promise<PlanItemContextRow | null> {
    const rows = await this.dbRw
      .select({
        plan_id: planItems.plan_id,
        plan_product_id: planItems.plan_product_id,
      })
      .from(planItems)
      .where(eq(planItems.plan_item_id, planItemId))
      .limit(1)
      .execute();

    return rows[0] ?? null;
  }

  async findCrossSellContext(
    planCrossSellId: string
  ): Promise<PlanEntitlementProductContext | null> {
    const [crossSellRows, accountRows] = await Promise.all([
      this.dbRw
        .select({ plan_product_id: planCrossSell.plan_product_id })
        .from(planCrossSell)
        .where(eq(planCrossSell.plan_cross_sell_id, planCrossSellId))
        .limit(1)
        .execute(),
      this.dbRw
        .selectDistinct({ account_id: planCrossSellAccount.account_id })
        .from(planCrossSellAccount)
        .where(eq(planCrossSellAccount.plan_cross_sell_id, planCrossSellId))
        .execute(),
    ]);

    const crossSell = crossSellRows[0];
    if (!crossSell) {
      return null;
    }

    return {
      planProductId: crossSell.plan_product_id,
      accountIds: accountRows.map((row) => row.account_id),
    };
  }

  async findCrossSellAccountContext(planCrossSellAccountId: string): Promise<{
    accountId: string;
    planProductId: string;
    planCrossSellId: string;
  } | null> {
    const rows = await this.dbRw
      .select({
        account_id: planCrossSellAccount.account_id,
        plan_product_id: planCrossSell.plan_product_id,
        plan_cross_sell_id: planCrossSell.plan_cross_sell_id,
      })
      .from(planCrossSellAccount)
      .innerJoin(
        planCrossSell,
        eq(
          planCrossSell.plan_cross_sell_id,
          planCrossSellAccount.plan_cross_sell_id
        )
      )
      .where(
        eq(
          planCrossSellAccount.plan_cross_sell_account_id,
          planCrossSellAccountId
        )
      )
      .limit(1)
      .execute();

    const row = rows[0];
    return row
      ? {
          accountId: row.account_id,
          planProductId: row.plan_product_id,
          planCrossSellId: row.plan_cross_sell_id,
        }
      : null;
  }
}
