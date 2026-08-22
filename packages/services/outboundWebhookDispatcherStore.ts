import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import * as schema from '@core/models';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createPlanEntitlementAuditContext } from '@core/services/planEntitlementTelemetryStore';

export const OUTBOUND_WEBHOOK_STATUS = {
  inactive: 'inactive',
  active: 'active',
  suspended: 'suspended',
} as const;

export const OUTBOUND_WEBHOOK_DELIVERY_STATUS = {
  pending: 'pending',
  leased: 'leased',
  retrying: 'retrying',
  succeeded: 'succeeded',
  dead: 'dead',
  suppressed: 'suppressed',
} as const;

export const OUTBOUND_WEBHOOK_MAX_ATTEMPTS = 7;

export type OutboundWebhookAttemptOutcome =
  | 'succeeded'
  | 'http_error'
  | 'network_error'
  | 'timeout'
  | 'internal_error'
  | 'suppressed';

export interface ClaimedOutboundWebhookDelivery {
  readonly deliveryId: string;
  readonly leaseToken: string;
}

export interface PreparedOutboundWebhookDelivery {
  readonly kind: 'ready';
  readonly deliveryId: string;
  readonly webhookId: string;
  readonly accountId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly endpointUrl: string;
  readonly secretEncrypted: string;
  readonly configVersion: number;
  readonly leaseToken: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
}

export interface SuppressedOutboundWebhookDelivery {
  readonly kind: 'suppressed';
  readonly deliveryId: string;
  readonly reason: string;
}

export interface LostOutboundWebhookDelivery {
  readonly kind: 'lost';
  readonly deliveryId: string;
}

export type OutboundWebhookPreparation =
  | PreparedOutboundWebhookDelivery
  | SuppressedOutboundWebhookDelivery
  | LostOutboundWebhookDelivery;

export interface CompleteOutboundWebhookAttemptInput {
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly configVersion: number;
  readonly deliveryStatus: 'succeeded' | 'retrying' | 'dead';
  readonly attemptOutcome: OutboundWebhookAttemptOutcome;
  readonly finishedAt: Date;
  readonly retryDelayMs?: number;
  readonly httpStatus: number | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly responseBody: string | null;
  readonly durationMs: number;
  readonly retryAfterMs: number | null;
  readonly suspendImmediately: boolean;
  readonly affectsEndpointHealth: boolean;
}

export interface OutboundWebhookSuspension {
  readonly webhookId: string;
  readonly accountId: string;
  readonly reason: 'http_410_gone' | 'consecutive_dead_deliveries';
}

export interface CompleteOutboundWebhookAttemptResult {
  readonly applied: boolean;
  readonly suspension: OutboundWebhookSuspension | null;
}

export interface OutboundWebhookDispatcherStore {
  claimDue(input: {
    limit: number;
    leaseToken: string;
    leaseDurationMs: number;
    now: Date;
  }): Promise<ClaimedOutboundWebhookDelivery[]>;
  prepareAttempt(input: {
    claim: ClaimedOutboundWebhookDelivery;
    attemptId: string;
    leaseDurationMs: number;
    now: Date;
  }): Promise<OutboundWebhookPreparation>;
  completeAttempt(
    input: CompleteOutboundWebhookAttemptInput
  ): Promise<CompleteOutboundWebhookAttemptResult>;
}

interface ClaimedDeliveryRow {
  outbound_webhook_delivery_id: string;
  lease_token: string;
}

interface FencedDeliveryRow {
  outbound_webhook_delivery_id: string;
}

interface PreparationRow {
  outbound_webhook_delivery_id: string;
  outbound_webhook_id: string;
  account_id: string;
  outbound_webhook_event_id: string;
  event_type: string;
  integration_entitlement_revision: string | null;
  integration_entitlement_source: 'plan' | 'addon' | null;
  payload: unknown;
  url: string;
  secret_encrypted: string;
  delivery_config_version: number;
  webhook_config_version: number;
  attempt_count: number;
  delivery_is_current: boolean;
  endpoint_is_eligible: boolean;
  event_is_ready: boolean;
  channel_is_available: boolean;
  channel_scope_matches: boolean;
  subscription_is_active: boolean;
  account_is_eligible: boolean;
  plan_is_eligible: boolean;
  integration_is_eligible: boolean;
  integration_revision_matches: boolean;
}

interface CompletionRow {
  outbound_webhook_id: string;
  account_id: string;
  webhook_status: string;
  webhook_config_version: number;
  consecutive_dead_deliveries: number;
  is_test: boolean;
  redelivery_of_delivery_id: string | null;
  attempt_finished_at: string | Date | null;
}

const rowsOf = <TRow>(result: unknown): TRow[] => {
  if (!result || typeof result !== 'object' || !('rows' in result)) {
    return [];
  }

  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as TRow[]) : [];
};

const toIsoString = (value: Date): string => value.toISOString();

const normalizeLeaseDurationMs = (value: number): number =>
  Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;

class OutboundWebhookLeaseLostError extends Error {
  constructor() {
    super('outbound_webhook_delivery_lease_lost');
    this.name = 'OutboundWebhookLeaseLostError';
  }
}

const preparationSuppressionReason = (row: PreparationRow): string | null => {
  if (!row.delivery_is_current) {
    return 'delivery_expired';
  }
  if (!row.event_is_ready) {
    return 'event_not_ready';
  }
  if (!row.channel_is_available) {
    return 'channel_unavailable';
  }
  if (!row.channel_scope_matches) {
    return 'channel_scope_mismatch';
  }
  if (!row.endpoint_is_eligible) {
    return 'endpoint_inactive';
  }
  if (row.delivery_config_version !== row.webhook_config_version) {
    return 'config_version_changed';
  }
  if (!row.subscription_is_active) {
    return 'subscription_inactive';
  }
  if (!row.account_is_eligible) {
    return 'account_ineligible';
  }
  if (!row.plan_is_eligible) {
    return 'plan_ineligible';
  }
  if (!row.integration_is_eligible || !row.integration_revision_matches) {
    return 'integration_entitlement_missing';
  }
  return null;
};

/**
 * Primary-database persistence for outbound delivery leasing and attempts.
 */
export class DrizzleOutboundWebhookDispatcherStore implements OutboundWebhookDispatcherStore {
  constructor(
    private readonly dbRw: NodePgDatabase<typeof schema>,
    private readonly databaseQueryTimeoutMs?: number
  ) {}

  private async applyTransactionLocalTimeout(
    transaction: Parameters<
      Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
    >[0]
  ): Promise<void> {
    if (!this.databaseQueryTimeoutMs) return;
    await transaction.execute(sql`
      SELECT set_config(
        'statement_timeout',
        ${String(Math.max(1, Math.floor(this.databaseQueryTimeoutMs)))},
        true
      )
    `);
  }

  async claimDue(input: {
    limit: number;
    leaseToken: string;
    leaseDurationMs: number;
    now: Date;
  }): Promise<ClaimedOutboundWebhookDelivery[]> {
    const limit = Math.max(1, Math.floor(input.limit));
    const now = toIsoString(input.now);
    const leaseDurationMs = normalizeLeaseDurationMs(input.leaseDurationMs);

    return this.dbRw.transaction(async (transaction) => {
      await this.applyTransactionLocalTimeout(transaction);
      const result = await transaction.execute(sql`
        WITH candidates AS MATERIALIZED (
          SELECT delivery.outbound_webhook_delivery_id
          FROM outbound_webhook_delivery AS delivery
          WHERE (
            (
              delivery.status IN (
                ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.pending},
                ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.retrying}
              )
              AND delivery.next_attempt_at <= clock_timestamp()
            )
            OR (
              delivery.status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.leased}
              AND delivery.lease_expires_at <= clock_timestamp()
            )
          )
          ORDER BY
            delivery.next_attempt_at ASC NULLS FIRST,
            delivery.created_at ASC,
            delivery.outbound_webhook_delivery_id ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        ), abandoned_attempts AS (
          UPDATE outbound_webhook_delivery_attempt AS attempt
          SET
            finished_at = CAST(${now} AS timestamptz),
            outcome = 'internal_error',
            error_code = 'lease_expired',
            error_message = 'Worker lease expired before attempt finalization',
            updated_at = CAST(${now} AS timestamptz)
          FROM candidates
          WHERE attempt.outbound_webhook_delivery_id =
            candidates.outbound_webhook_delivery_id
            AND attempt.finished_at IS NULL
          RETURNING attempt.outbound_webhook_delivery_attempt_id
        ), exhausted AS (
          UPDATE outbound_webhook_delivery AS delivery
          SET
            status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.dead},
            lease_token = NULL,
            lease_expires_at = NULL,
            dead_at = CAST(${now} AS timestamptz),
            last_error = 'lease_expired_attempts_exhausted',
            updated_at = CAST(${now} AS timestamptz)
          FROM candidates
          WHERE delivery.outbound_webhook_delivery_id =
            candidates.outbound_webhook_delivery_id
            AND delivery.attempt_count >= ${OUTBOUND_WEBHOOK_MAX_ATTEMPTS}
          RETURNING delivery.outbound_webhook_delivery_id
        ), claimed AS (
          UPDATE outbound_webhook_delivery AS delivery
          SET
            status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.leased},
            lease_token = ${input.leaseToken},
            lease_expires_at = clock_timestamp() +
              (${leaseDurationMs} * INTERVAL '1 millisecond'),
            updated_at = CAST(${now} AS timestamptz)
          FROM candidates
          WHERE delivery.outbound_webhook_delivery_id =
            candidates.outbound_webhook_delivery_id
            AND delivery.attempt_count < ${OUTBOUND_WEBHOOK_MAX_ATTEMPTS}
          RETURNING
            delivery.outbound_webhook_delivery_id,
            delivery.lease_token
        )
        SELECT
          claimed.outbound_webhook_delivery_id,
          claimed.lease_token
        FROM claimed
      `);

      return rowsOf<ClaimedDeliveryRow>(result).map((row) => ({
        deliveryId: row.outbound_webhook_delivery_id,
        leaseToken: row.lease_token,
      }));
    });
  }

  async prepareAttempt(input: {
    claim: ClaimedOutboundWebhookDelivery;
    attemptId: string;
    leaseDurationMs: number;
    now: Date;
  }): Promise<OutboundWebhookPreparation> {
    const now = toIsoString(input.now);
    const leaseDurationMs = normalizeLeaseDurationMs(input.leaseDurationMs);

    try {
      return await this.dbRw.transaction(async (transaction) => {
        await this.applyTransactionLocalTimeout(transaction);
        const result = await transaction.execute(sql`
        SELECT
          delivery.outbound_webhook_delivery_id,
          delivery.outbound_webhook_id,
          webhook.account_id,
          event.outbound_webhook_event_id,
          event.event_type,
          event.integration_entitlement_revision,
          integration_entitlement.source AS integration_entitlement_source,
          event.payload,
          webhook.url,
          webhook.secret_encrypted,
          delivery.config_version AS delivery_config_version,
          webhook.config_version AS webhook_config_version,
          delivery.attempt_count,
          (delivery.expires_at > clock_timestamp()) AS delivery_is_current,
          (
            (
              webhook.status = ${OUTBOUND_WEBHOOK_STATUS.active}
              OR (
                event.is_test = TRUE
                AND event.event_type = 'webhook.test'
              )
            )
            AND webhook.deleted_at IS NULL
          ) AS endpoint_is_eligible,
          (
            event.state = 'ready'
            AND event.account_id = webhook.account_id
            AND event.expires_at > clock_timestamp()
          ) AS event_is_ready,
          (
            channel.worker_id IS NOT NULL
            AND channel.deleted_at IS NULL
          ) AS channel_is_available,
          (
            webhook.channel_id = ANY(event.routing_channel_ids)
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(event.target_snapshot) AS captured_target
              WHERE captured_target ->> 'webhook_id' =
                webhook.outbound_webhook_id::text
                AND captured_target ->> 'channel_id' =
                  webhook.channel_id::text
            )
          ) AS channel_scope_matches,
          (
            (
              event.is_test = TRUE
              AND event.event_type = 'webhook.test'
            )
            OR EXISTS (
              SELECT 1
              FROM outbound_webhook_subscription AS subscription
              WHERE subscription.outbound_webhook_id = webhook.outbound_webhook_id
                AND subscription.event_type = event.event_type
                AND subscription.active = TRUE
                AND subscription.deleted_at IS NULL
            )
          ) AS subscription_is_active,
          (
            account.account_id IS NOT NULL
            AND account.account_status_id <> ${EAccountStatus.blocked}
            AND account.deleted_at IS NULL
          ) AS account_is_eligible,
          EXISTS (
            SELECT 1
            FROM (
              SELECT
                plan_account.plan_id,
                plan_account.next_payment_date
              FROM plan_account
              WHERE plan_account.account_id = webhook.account_id
              ORDER BY
                plan_account.updated_at DESC NULLS LAST,
                plan_account.created_at DESC NULLS LAST,
                plan_account.plan_account_id DESC
              LIMIT 1
            ) AS latest_plan_account
            INNER JOIN plan
              ON plan.plan_id = latest_plan_account.plan_id
            WHERE latest_plan_account.next_payment_date > clock_timestamp()
              AND plan.deleted_at IS NULL
          ) AS plan_is_eligible,
          (integration_entitlement.source IS NOT NULL) AS integration_is_eligible,
          (
            event.integration_entitlement_revision IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM account_plan_product_entitlement_revision AS entitlement_revision
              WHERE entitlement_revision.account_id = webhook.account_id
                AND entitlement_revision.plan_product_id =
                  ${EPlanProduct.integration}
                AND entitlement_revision.allowed = TRUE
                AND (
                  entitlement_revision.deny_fence_token IS NULL
                  OR entitlement_revision.deny_fence_released_at IS NOT NULL
                )
                AND entitlement_revision.revision::text =
                  event.integration_entitlement_revision
            )
          ) AS integration_revision_matches
        FROM outbound_webhook_delivery AS delivery
        INNER JOIN outbound_webhook AS webhook
          ON webhook.outbound_webhook_id = delivery.outbound_webhook_id
        INNER JOIN outbound_webhook_event AS event
          ON event.outbound_webhook_event_id =
            delivery.outbound_webhook_event_id
        LEFT JOIN account
          ON account.account_id = webhook.account_id
        LEFT JOIN worker AS channel
          ON channel.account_id = webhook.account_id
          AND channel.worker_id = webhook.channel_id
        LEFT JOIN LATERAL (
          SELECT CASE
            WHEN current_integration_plan.next_payment_date IS NULL
              OR current_integration_plan.next_payment_date <= clock_timestamp()
              OR integration_plan.deleted_at IS NOT NULL
            THEN NULL
            WHEN EXISTS (
              SELECT 1
              FROM plan_items AS integration_plan_item
              WHERE integration_plan_item.plan_id =
                current_integration_plan.plan_id
                AND integration_plan_item.plan_product_id =
                  ${EPlanProduct.integration}
                AND integration_plan_item.quantity > 0
                AND integration_plan_item.deleted_at IS NULL
            ) THEN 'plan'
            WHEN EXISTS (
              SELECT 1
              FROM plan_cross_sell_account AS integration_addon_account
              INNER JOIN plan_cross_sell AS integration_addon
                ON integration_addon.plan_cross_sell_id =
                  integration_addon_account.plan_cross_sell_id
              WHERE integration_addon_account.account_id = webhook.account_id
                AND integration_addon_account.deleted_at IS NULL
                AND integration_addon.deleted_at IS NULL
                AND integration_addon.plan_product_id =
                  ${EPlanProduct.integration}
                AND integration_addon.quantity > 0
                AND (
                  integration_addon_account.cancellation_date IS NULL
                  OR current_integration_plan.last_payment_date IS NULL
                  OR integration_addon_account.cancellation_date >=
                    current_integration_plan.last_payment_date
                )
            ) THEN 'addon'
            ELSE NULL
          END AS source
          FROM (
            SELECT
              integration_plan_account.plan_id,
              integration_plan_account.last_payment_date,
              integration_plan_account.next_payment_date
            FROM plan_account AS integration_plan_account
            WHERE integration_plan_account.account_id = webhook.account_id
            ORDER BY
              integration_plan_account.updated_at DESC NULLS LAST,
              integration_plan_account.created_at DESC NULLS LAST,
              integration_plan_account.plan_account_id DESC
            LIMIT 1
          ) AS current_integration_plan
          INNER JOIN plan AS integration_plan
            ON integration_plan.plan_id = current_integration_plan.plan_id
        ) AS integration_entitlement ON TRUE
        WHERE delivery.outbound_webhook_delivery_id = ${input.claim.deliveryId}
          AND delivery.status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.leased}
          AND delivery.lease_token = ${input.claim.leaseToken}
          AND delivery.lease_expires_at > clock_timestamp()
        FOR UPDATE OF delivery
      `);
        const row = rowsOf<PreparationRow>(result)[0];
        if (!row) {
          return {
            kind: 'lost',
            deliveryId: input.claim.deliveryId,
          };
        }

        const attemptNumber = Number(row.attempt_count) + 1;
        const suppressionReason = preparationSuppressionReason(row);

        await transaction.execute(sql`
        INSERT INTO outbound_webhook_delivery_attempt (
          outbound_webhook_delivery_attempt_id,
          outbound_webhook_delivery_id,
          attempt_number,
          started_at,
          finished_at,
          outcome,
          error_code,
          error_message,
          duration_ms,
          created_at,
          updated_at
        ) VALUES (
          ${input.attemptId},
          ${input.claim.deliveryId},
          ${attemptNumber},
          CAST(${now} AS timestamptz),
          ${suppressionReason ? sql`CAST(${now} AS timestamptz)` : sql`NULL`},
          ${suppressionReason ? 'suppressed' : null},
          ${suppressionReason},
          ${
            suppressionReason
              ? 'Delivery suppressed by preflight revalidation'
              : null
          },
          ${suppressionReason ? 0 : null},
          CAST(${now} AS timestamptz),
          CAST(${now} AS timestamptz)
        )
      `);

        if (suppressionReason) {
          const suppressed = await transaction.execute(sql`
          UPDATE outbound_webhook_delivery
          SET
            status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.suppressed},
            attempt_count = ${attemptNumber},
            lease_token = NULL,
            lease_expires_at = NULL,
            suppressed_at = CAST(${now} AS timestamptz),
            last_error = ${suppressionReason},
            updated_at = CAST(${now} AS timestamptz)
          WHERE outbound_webhook_delivery_id = ${input.claim.deliveryId}
            AND status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.leased}
            AND lease_token = ${input.claim.leaseToken}
          RETURNING outbound_webhook_delivery_id
        `);
          if (rowsOf<FencedDeliveryRow>(suppressed).length !== 1) {
            throw new OutboundWebhookLeaseLostError();
          }

          if (suppressionReason === 'integration_entitlement_missing') {
            console.warn(
              '[PlanEntitlementAudit] Outbound webhook delivery suppressed',
              createPlanEntitlementAuditContext({
                surface: 'outbound_dispatcher',
                outcome: 'denied',
                accountId: row.account_id,
                planProductId: EPlanProduct.integration,
                revision: row.integration_entitlement_revision,
                source: row.integration_entitlement_source,
                eventId: row.outbound_webhook_event_id,
                reason: suppressionReason,
              })
            );
          }

          return {
            kind: 'suppressed',
            deliveryId: input.claim.deliveryId,
            reason: suppressionReason,
          };
        }

        const renewed = await transaction.execute(sql`
        UPDATE outbound_webhook_delivery
        SET
          attempt_count = ${attemptNumber},
          lease_expires_at = clock_timestamp() +
            (${leaseDurationMs} * INTERVAL '1 millisecond'),
          updated_at = clock_timestamp()
        WHERE outbound_webhook_delivery_id = ${input.claim.deliveryId}
          AND status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.leased}
          AND lease_token = ${input.claim.leaseToken}
        RETURNING outbound_webhook_delivery_id
      `);
        if (rowsOf<FencedDeliveryRow>(renewed).length !== 1) {
          throw new OutboundWebhookLeaseLostError();
        }

        console.info(
          '[PlanEntitlementAudit] Outbound webhook delivery admitted',
          createPlanEntitlementAuditContext({
            surface: 'outbound_dispatcher',
            outcome: 'allowed',
            accountId: row.account_id,
            planProductId: EPlanProduct.integration,
            revision: row.integration_entitlement_revision,
            source: row.integration_entitlement_source,
            eventId: row.outbound_webhook_event_id,
          })
        );

        return {
          kind: 'ready',
          deliveryId: row.outbound_webhook_delivery_id,
          webhookId: row.outbound_webhook_id,
          accountId: row.account_id,
          eventId: row.outbound_webhook_event_id,
          eventType: row.event_type,
          payload: row.payload,
          endpointUrl: row.url,
          secretEncrypted: row.secret_encrypted,
          configVersion: Number(row.webhook_config_version),
          leaseToken: input.claim.leaseToken,
          attemptId: input.attemptId,
          attemptNumber,
        };
      });
    } catch (error: unknown) {
      if (error instanceof OutboundWebhookLeaseLostError) {
        return { kind: 'lost', deliveryId: input.claim.deliveryId };
      }
      throw error;
    }
  }

  async completeAttempt(
    input: CompleteOutboundWebhookAttemptInput
  ): Promise<CompleteOutboundWebhookAttemptResult> {
    const finishedAt = toIsoString(input.finishedAt);

    return this.dbRw.transaction(async (transaction) => {
      await this.applyTransactionLocalTimeout(transaction);
      const selected = await transaction.execute(sql`
        SELECT
          webhook.outbound_webhook_id,
          webhook.account_id,
          webhook.status AS webhook_status,
          webhook.config_version AS webhook_config_version,
          webhook.consecutive_dead_deliveries,
          event.is_test,
          delivery.redelivery_of_delivery_id,
          attempt.finished_at AS attempt_finished_at
        FROM outbound_webhook_delivery AS delivery
        INNER JOIN outbound_webhook AS webhook
          ON webhook.outbound_webhook_id = delivery.outbound_webhook_id
        INNER JOIN outbound_webhook_event AS event
          ON event.outbound_webhook_event_id =
            delivery.outbound_webhook_event_id
        INNER JOIN outbound_webhook_delivery_attempt AS attempt
          ON attempt.outbound_webhook_delivery_attempt_id = ${input.attemptId}
          AND attempt.outbound_webhook_delivery_id =
            delivery.outbound_webhook_delivery_id
          AND attempt.attempt_number = ${input.attemptNumber}
        WHERE delivery.outbound_webhook_delivery_id = ${input.deliveryId}
          AND delivery.status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.leased}
          AND delivery.lease_token = ${input.leaseToken}
        FOR UPDATE OF delivery, webhook, attempt
      `);
      const row = rowsOf<CompletionRow>(selected)[0];
      if (!row || row.attempt_finished_at) {
        return { applied: false, suspension: null };
      }

      await transaction.execute(sql`
        UPDATE outbound_webhook_delivery_attempt
        SET
          finished_at = CAST(${finishedAt} AS timestamptz),
          outcome = ${input.attemptOutcome},
          http_status = ${input.httpStatus},
          error_code = ${input.errorCode},
          error_message = ${input.errorMessage},
          response_body = ${input.responseBody},
          duration_ms = ${Math.max(0, Math.floor(input.durationMs))},
          retry_after_ms = ${input.retryAfterMs},
          updated_at = CAST(${finishedAt} AS timestamptz)
        WHERE outbound_webhook_delivery_attempt_id = ${input.attemptId}
          AND finished_at IS NULL
      `);

      if (input.deliveryStatus === 'succeeded') {
        await transaction.execute(sql`
          UPDATE outbound_webhook_delivery
          SET
            status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.succeeded},
            lease_token = NULL,
            lease_expires_at = NULL,
            delivered_at = CAST(${finishedAt} AS timestamptz),
            last_error = NULL,
            updated_at = CAST(${finishedAt} AS timestamptz)
          WHERE outbound_webhook_delivery_id = ${input.deliveryId}
            AND status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.leased}
            AND lease_token = ${input.leaseToken}
        `);
      } else if (input.deliveryStatus === 'retrying') {
        if (
          !Number.isFinite(input.retryDelayMs) ||
          (input.retryDelayMs ?? -1) < 0
        ) {
          throw new Error('Retrying outbound delivery requires retryDelayMs');
        }
        const retryDelayMs = Math.min(
          24 * 60 * 60 * 1_000,
          Math.floor(input.retryDelayMs as number)
        );
        await transaction.execute(sql`
          UPDATE outbound_webhook_delivery
          SET
            status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.retrying},
            lease_token = NULL,
            lease_expires_at = NULL,
            next_attempt_at = clock_timestamp() +
              (${retryDelayMs} * INTERVAL '1 millisecond'),
            last_error = ${input.errorMessage ?? input.errorCode},
            updated_at = CAST(${finishedAt} AS timestamptz)
          WHERE outbound_webhook_delivery_id = ${input.deliveryId}
            AND status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.leased}
            AND lease_token = ${input.leaseToken}
        `);
      } else {
        await transaction.execute(sql`
          UPDATE outbound_webhook_delivery
          SET
            status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.dead},
            lease_token = NULL,
            lease_expires_at = NULL,
            dead_at = CAST(${finishedAt} AS timestamptz),
            last_error = ${input.errorMessage ?? input.errorCode},
            updated_at = CAST(${finishedAt} AS timestamptz)
          WHERE outbound_webhook_delivery_id = ${input.deliveryId}
            AND status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.leased}
            AND lease_token = ${input.leaseToken}
        `);
      }

      const isLogicalLiveDelivery =
        row.is_test !== true && !row.redelivery_of_delivery_id;
      const canUpdateEndpointHealth =
        input.affectsEndpointHealth &&
        row.webhook_status === OUTBOUND_WEBHOOK_STATUS.active &&
        Number(row.webhook_config_version) === input.configVersion;
      let suspension: OutboundWebhookSuspension | null = null;

      if (
        input.deliveryStatus === 'succeeded' &&
        isLogicalLiveDelivery &&
        canUpdateEndpointHealth &&
        Number(row.consecutive_dead_deliveries) !== 0
      ) {
        await transaction.execute(sql`
          UPDATE outbound_webhook
          SET
            consecutive_dead_deliveries = 0,
            updated_at = CAST(${finishedAt} AS timestamptz)
          WHERE outbound_webhook_id = ${row.outbound_webhook_id}
            AND status = ${OUTBOUND_WEBHOOK_STATUS.active}
            AND config_version = ${input.configVersion}
        `);
      }

      if (
        input.deliveryStatus === 'dead' &&
        canUpdateEndpointHealth &&
        (input.suspendImmediately || isLogicalLiveDelivery)
      ) {
        const consecutiveDeadDeliveries =
          Number(row.consecutive_dead_deliveries) +
          (isLogicalLiveDelivery ? 1 : 0);
        const shouldSuspend =
          input.suspendImmediately || consecutiveDeadDeliveries >= 5;
        const suspensionReason = input.suspendImmediately
          ? ('http_410_gone' as const)
          : ('consecutive_dead_deliveries' as const);

        await transaction.execute(sql`
          UPDATE outbound_webhook
          SET
            consecutive_dead_deliveries = ${consecutiveDeadDeliveries},
            status = ${
              shouldSuspend
                ? OUTBOUND_WEBHOOK_STATUS.suspended
                : OUTBOUND_WEBHOOK_STATUS.active
            },
            suspended_at = ${
              shouldSuspend ? sql`CAST(${finishedAt} AS timestamptz)` : null
            },
            suspension_reason = ${shouldSuspend ? suspensionReason : null},
            updated_at = CAST(${finishedAt} AS timestamptz)
          WHERE outbound_webhook_id = ${row.outbound_webhook_id}
            AND status = ${OUTBOUND_WEBHOOK_STATUS.active}
            AND config_version = ${input.configVersion}
        `);

        if (shouldSuspend) {
          await transaction.execute(sql`
            UPDATE outbound_webhook_delivery
            SET
              status = ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.suppressed},
              suppressed_at = CAST(${finishedAt} AS timestamptz),
              last_error = ${suspensionReason},
              updated_at = CAST(${finishedAt} AS timestamptz)
            WHERE outbound_webhook_id = ${row.outbound_webhook_id}
              AND outbound_webhook_delivery_id <> ${input.deliveryId}
              AND status IN (
                ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.pending},
                ${OUTBOUND_WEBHOOK_DELIVERY_STATUS.retrying}
              )
          `);

          suspension = {
            webhookId: row.outbound_webhook_id,
            accountId: row.account_id,
            reason: suspensionReason,
          };
        }
      }

      return { applied: true, suspension };
    });
  }
}
