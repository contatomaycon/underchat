import type * as schema from '@core/models';
import {
  account,
  outboundWebhook,
  outboundWebhookDelivery,
  outboundWebhookDeliveryAttempt,
  outboundWebhookEvent,
  outboundWebhookSubscription,
  plan,
  planAccount,
  worker,
  OutboundWebhookDeliveryAttemptOutcome,
  OutboundWebhookDeliveryStatus,
  OutboundWebhookStatus,
} from '@core/models';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { OUTBOUND_WEBHOOK_MAX_ENDPOINTS_PER_ACCOUNT } from '@core/common/constants/outboundWebhookEvents';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

export interface OutboundWebhookRecord {
  outbound_webhook_id: string;
  channel_id: string;
  channel: {
    id: string;
    name: string;
    number: string | null;
    available: boolean;
  };
  name: string;
  url: string;
  status: OutboundWebhookStatus;
  secret_preview: string;
  config_version: number;
  event_types: string[];
  verified_at: string | null;
  consecutive_dead_deliveries: number;
  suspended_at: string | null;
  suspension_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOutboundWebhookRepositoryInput {
  outbound_webhook_id: string;
  account_id: string;
  channel_id: string;
  name: string;
  url: string;
  secret_hash: string;
  secret_encrypted: string;
  secret_preview: string;
  event_types: string[];
}

export interface UpdateOutboundWebhookRepositoryInput {
  name?: string;
  url?: string;
  channel_id?: string;
  event_types?: string[];
}

export interface RotateOutboundWebhookRepositoryInput {
  secret_hash: string;
  secret_encrypted: string;
  secret_preview: string;
}

export interface OutboundWebhookDeliveryCursor {
  createdAt: string;
  deliveryId: string;
}

export interface OutboundWebhookDeliveryRecord {
  outbound_webhook_delivery_id: string;
  outbound_webhook_id: string;
  outbound_webhook_event_id: string;
  event_type: string;
  is_test: boolean;
  config_version: number;
  status: OutboundWebhookDeliveryStatus;
  attempt_count: number;
  response_status: number | null;
  next_attempt_at: string;
  delivered_at: string | null;
  dead_at: string | null;
  suppressed_at: string | null;
  last_error: string | null;
  redelivery_of_delivery_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutboundWebhookDeliveryAttemptRecord {
  outbound_webhook_delivery_attempt_id: string;
  attempt_number: number;
  started_at: string;
  finished_at: string | null;
  outcome: OutboundWebhookDeliveryAttemptOutcome | null;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  response_body: string | null;
  duration_ms: number | null;
  retry_after_ms: number | null;
  created_at: string;
}

export interface OutboundWebhookDeliveryDetailRecord extends OutboundWebhookDeliveryRecord {
  payload: Record<string, unknown>;
  attempts: OutboundWebhookDeliveryAttemptRecord[];
}

export type ActivateOutboundWebhookRepositoryResult =
  | 'activated'
  | 'deactivated'
  | 'not_found'
  | 'no_events'
  | 'unverified'
  | 'channel_unavailable';

export type CreateOutboundWebhookRepositoryResult =
  'created' | 'endpoint_limit' | 'invalid_channel';

export type UpdateOutboundWebhookRepositoryResult =
  'updated' | 'not_found' | 'invalid_channel';

export type RedeliverOutboundWebhookRepositoryResult =
  | {
      status: 'created';
      outbound_webhook_event_id: string;
      outbound_webhook_delivery_id: string;
    }
  | { status: 'not_found' }
  | { status: 'endpoint_inactive' }
  | { status: 'channel_unavailable' }
  | { status: 'entitlement_epoch_mismatch' }
  | { status: 'not_redeliverable' };

@injectable()
export class OutboundWebhookRepository {
  constructor(
    @inject('DatabaseRw')
    private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private listBase = async (
    accountId: string,
    webhookId?: string
  ): Promise<OutboundWebhookRecord[]> => {
    const filters = [
      eq(outboundWebhook.account_id, accountId),
      isNull(outboundWebhook.deleted_at),
    ];
    if (webhookId) {
      filters.push(eq(outboundWebhook.outbound_webhook_id, webhookId));
    }

    const rows = await this.dbRw
      .select({
        outbound_webhook_id: outboundWebhook.outbound_webhook_id,
        channel_id: outboundWebhook.channel_id,
        channel_name: worker.name,
        channel_number: worker.number,
        channel_available: sql<boolean>`${worker.deleted_at} IS NULL`,
        name: outboundWebhook.name,
        url: outboundWebhook.url,
        status: outboundWebhook.status,
        secret_preview: outboundWebhook.secret_preview,
        config_version: outboundWebhook.config_version,
        verified_at: sql<string | null>`(
          SELECT MAX(verification_delivery.delivered_at)
          FROM outbound_webhook_delivery verification_delivery
          INNER JOIN outbound_webhook_event verification_event
            ON verification_event.outbound_webhook_event_id = verification_delivery.outbound_webhook_event_id
          WHERE verification_delivery.outbound_webhook_id = ${outboundWebhook.outbound_webhook_id}
            AND verification_delivery.config_version = ${outboundWebhook.config_version}
            AND verification_delivery.status = 'succeeded'
            AND verification_event.is_test = TRUE
            AND verification_event.event_type = 'webhook.test'
            AND verification_event.state = 'ready'
            AND verification_event.account_id = ${outboundWebhook.account_id}
            AND verification_event.payload #>> '{data,verification,config_version}' =
              CAST(${outboundWebhook.config_version} AS text)
        )`.mapWith(outboundWebhookDelivery.delivered_at),
        consecutive_dead_deliveries:
          outboundWebhook.consecutive_dead_deliveries,
        suspended_at: outboundWebhook.suspended_at,
        suspension_reason: outboundWebhook.suspension_reason,
        created_at: outboundWebhook.created_at,
        updated_at: outboundWebhook.updated_at,
      })
      .from(outboundWebhook)
      .innerJoin(
        worker,
        and(
          eq(worker.account_id, outboundWebhook.account_id),
          eq(worker.worker_id, outboundWebhook.channel_id)
        )
      )
      .where(and(...filters))
      .orderBy(
        desc(outboundWebhook.created_at),
        desc(outboundWebhook.outbound_webhook_id)
      )
      .execute();

    if (rows.length === 0) return [];

    const webhookIds = rows.map((row) => row.outbound_webhook_id);
    const subscriptions = await this.dbRw
      .select({
        outbound_webhook_id: outboundWebhookSubscription.outbound_webhook_id,
        event_type: outboundWebhookSubscription.event_type,
      })
      .from(outboundWebhookSubscription)
      .where(
        and(
          inArray(outboundWebhookSubscription.outbound_webhook_id, webhookIds),
          eq(outboundWebhookSubscription.active, true),
          isNull(outboundWebhookSubscription.deleted_at)
        )
      )
      .orderBy(asc(outboundWebhookSubscription.event_type))
      .execute();

    const eventTypesByWebhook = new Map<string, string[]>();
    for (const subscription of subscriptions) {
      const eventTypes =
        eventTypesByWebhook.get(subscription.outbound_webhook_id) ?? [];
      eventTypes.push(subscription.event_type);
      eventTypesByWebhook.set(subscription.outbound_webhook_id, eventTypes);
    }

    return rows.map((row) => ({
      outbound_webhook_id: row.outbound_webhook_id,
      channel_id: row.channel_id,
      channel: {
        id: row.channel_id,
        name: row.channel_name,
        number: row.channel_number,
        available: row.channel_available,
      },
      name: row.name,
      url: row.url,
      status: row.status,
      secret_preview: row.secret_preview,
      config_version: row.config_version,
      event_types: eventTypesByWebhook.get(row.outbound_webhook_id) ?? [],
      verified_at: row.verified_at,
      consecutive_dead_deliveries: row.consecutive_dead_deliveries,
      suspended_at: row.suspended_at,
      suspension_reason: row.suspension_reason,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  };

  list = async (accountId: string): Promise<OutboundWebhookRecord[]> =>
    this.listBase(accountId);

  findById = async (
    accountId: string,
    webhookId: string
  ): Promise<OutboundWebhookRecord | null> => {
    const rows = await this.listBase(accountId, webhookId);
    return rows[0] ?? null;
  };

  create = async (
    input: CreateOutboundWebhookRepositoryInput
  ): Promise<CreateOutboundWebhookRepositoryResult> => {
    return this.dbRw.transaction(async (tx) => {
      const lockedAccount = await tx
        .select({ id: account.account_id })
        .from(account)
        .where(eq(account.account_id, input.account_id))
        .for('update', { of: account })
        .limit(1)
        .execute();
      if (!lockedAccount[0]) return 'invalid_channel';

      const channelRows = await tx
        .select({ id: worker.worker_id })
        .from(worker)
        .where(
          and(
            eq(worker.worker_id, input.channel_id),
            eq(worker.account_id, input.account_id),
            isNull(worker.deleted_at)
          )
        )
        .for('update', { of: worker })
        .limit(1)
        .execute();
      if (!channelRows[0]) return 'invalid_channel';

      const counts = await tx
        .select({ count: sql<number>`COUNT(*)::integer` })
        .from(outboundWebhook)
        .where(
          and(
            eq(outboundWebhook.account_id, input.account_id),
            isNull(outboundWebhook.deleted_at)
          )
        )
        .execute();
      if (
        Number(counts[0]?.count ?? 0) >=
        OUTBOUND_WEBHOOK_MAX_ENDPOINTS_PER_ACCOUNT
      ) {
        return 'endpoint_limit';
      }

      await tx
        .insert(outboundWebhook)
        .values({
          outbound_webhook_id: input.outbound_webhook_id,
          account_id: input.account_id,
          channel_id: input.channel_id,
          name: input.name,
          url: input.url,
          secret_hash: input.secret_hash,
          secret_encrypted: input.secret_encrypted,
          secret_preview: input.secret_preview,
          status: 'inactive',
          config_version: 1,
        })
        .execute();

      if (input.event_types.length > 0) {
        await tx
          .insert(outboundWebhookSubscription)
          .values(
            input.event_types.map((eventType) => ({
              outbound_webhook_subscription_id: uuidv7(),
              outbound_webhook_id: input.outbound_webhook_id,
              event_type: eventType,
              active: true,
            }))
          )
          .execute();
      }

      return 'created';
    });
  };

  update = async (
    accountId: string,
    webhookId: string,
    input: UpdateOutboundWebhookRepositoryInput
  ): Promise<UpdateOutboundWebhookRepositoryResult> => {
    return this.dbRw.transaction(async (tx) => {
      if (input.channel_id !== undefined) {
        const channelRows = await tx
          .select({ id: worker.worker_id })
          .from(worker)
          .where(
            and(
              eq(worker.worker_id, input.channel_id),
              eq(worker.account_id, accountId),
              isNull(worker.deleted_at)
            )
          )
          .for('update')
          .limit(1)
          .execute();
        if (!channelRows[0]) return 'invalid_channel';
      }

      const currentRows = await tx
        .select({
          url: outboundWebhook.url,
          channel_id: outboundWebhook.channel_id,
        })
        .from(outboundWebhook)
        .where(
          and(
            eq(outboundWebhook.outbound_webhook_id, webhookId),
            eq(outboundWebhook.account_id, accountId),
            isNull(outboundWebhook.deleted_at)
          )
        )
        .for('update', { of: outboundWebhook })
        .limit(1)
        .execute();
      const current = currentRows[0];
      if (!current) return 'not_found';

      const now = new Date().toISOString();
      const hasUrlChanged =
        input.url !== undefined && input.url !== current.url;
      const hasChannelChanged =
        input.channel_id !== undefined &&
        input.channel_id !== current.channel_id;
      const hasSigningConfigChanged = hasUrlChanged || hasChannelChanged;

      await tx
        .update(outboundWebhook)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.channel_id !== undefined
            ? { channel_id: input.channel_id }
            : {}),
          ...(hasSigningConfigChanged
            ? {
                config_version: sql`${outboundWebhook.config_version} + 1`,
                status: 'inactive' as const,
                consecutive_dead_deliveries: 0,
                suspended_at: null,
                suspension_reason: null,
              }
            : {}),
          updated_at: now,
        })
        .where(eq(outboundWebhook.outbound_webhook_id, webhookId))
        .execute();

      if (input.event_types !== undefined) {
        await tx
          .update(outboundWebhookSubscription)
          .set({ active: false, deleted_at: now, updated_at: now })
          .where(eq(outboundWebhookSubscription.outbound_webhook_id, webhookId))
          .execute();

        if (input.event_types.length > 0) {
          await tx
            .insert(outboundWebhookSubscription)
            .values(
              input.event_types.map((eventType) => ({
                outbound_webhook_subscription_id: uuidv7(),
                outbound_webhook_id: webhookId,
                event_type: eventType,
                active: true,
                created_at: now,
                updated_at: now,
                deleted_at: null,
              }))
            )
            .onConflictDoUpdate({
              target: [
                outboundWebhookSubscription.outbound_webhook_id,
                outboundWebhookSubscription.event_type,
              ],
              set: { active: true, deleted_at: null, updated_at: now },
            })
            .execute();
        }
      }

      return 'updated';
    });
  };

  softDelete = async (
    accountId: string,
    webhookId: string
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      const now = new Date().toISOString();
      const deleted = await tx
        .update(outboundWebhook)
        .set({ status: 'inactive', deleted_at: now, updated_at: now })
        .where(
          and(
            eq(outboundWebhook.outbound_webhook_id, webhookId),
            eq(outboundWebhook.account_id, accountId),
            isNull(outboundWebhook.deleted_at)
          )
        )
        .returning({ id: outboundWebhook.outbound_webhook_id })
        .execute();
      if (!deleted[0]) return false;

      await tx
        .update(outboundWebhookSubscription)
        .set({ active: false, deleted_at: now, updated_at: now })
        .where(
          and(
            eq(outboundWebhookSubscription.outbound_webhook_id, webhookId),
            isNull(outboundWebhookSubscription.deleted_at)
          )
        )
        .execute();

      await tx
        .update(outboundWebhookDelivery)
        .set({
          status: 'suppressed',
          suppressed_at: now,
          last_error: 'endpoint_deleted',
          lease_token: null,
          lease_expires_at: null,
          updated_at: now,
        })
        .where(
          and(
            eq(outboundWebhookDelivery.outbound_webhook_id, webhookId),
            inArray(outboundWebhookDelivery.status, ['pending', 'retrying'])
          )
        )
        .execute();

      return true;
    });
  };

  rotateSecret = async (
    accountId: string,
    webhookId: string,
    input: RotateOutboundWebhookRepositoryInput
  ): Promise<number | null> => {
    const now = new Date().toISOString();
    const result = await this.dbRw
      .update(outboundWebhook)
      .set({
        secret_hash: input.secret_hash,
        secret_encrypted: input.secret_encrypted,
        secret_preview: input.secret_preview,
        config_version: sql`${outboundWebhook.config_version} + 1`,
        status: 'inactive',
        consecutive_dead_deliveries: 0,
        suspended_at: null,
        suspension_reason: null,
        updated_at: now,
      })
      .where(
        and(
          eq(outboundWebhook.outbound_webhook_id, webhookId),
          eq(outboundWebhook.account_id, accountId),
          isNull(outboundWebhook.deleted_at)
        )
      )
      .returning({ configVersion: outboundWebhook.config_version })
      .execute();

    return result[0]?.configVersion ?? null;
  };

  isAccountEligible = async (accountId: string): Promise<boolean> => {
    const rows = await this.dbRw
      .select({
        account_status_id: account.account_status_id,
        account_deleted_at: account.deleted_at,
        plan_is_current: sql<boolean>`COALESCE(${planAccount.next_payment_date} > NOW(), FALSE)`,
        plan_deleted_at: plan.deleted_at,
      })
      .from(account)
      .innerJoin(planAccount, eq(planAccount.account_id, account.account_id))
      .innerJoin(plan, eq(plan.plan_id, planAccount.plan_id))
      .where(eq(account.account_id, accountId))
      .orderBy(
        sql`${planAccount.updated_at} DESC NULLS LAST`,
        sql`${planAccount.created_at} DESC NULLS LAST`,
        desc(planAccount.plan_account_id)
      )
      .limit(1)
      .execute();

    const current = rows[0];
    if (!current) return false;

    return (
      current.account_status_id !== EAccountStatus.blocked &&
      current.account_deleted_at === null &&
      current.plan_is_current &&
      current.plan_deleted_at === null
    );
  };

  setActive = async (
    accountId: string,
    webhookId: string,
    active: boolean
  ): Promise<ActivateOutboundWebhookRepositoryResult> => {
    return this.dbRw.transaction(async (tx) => {
      const webhookRows = await tx
        .select({
          config_version: outboundWebhook.config_version,
          channel_available: sql<boolean>`${worker.deleted_at} IS NULL`,
        })
        .from(outboundWebhook)
        .innerJoin(
          worker,
          and(
            eq(worker.account_id, outboundWebhook.account_id),
            eq(worker.worker_id, outboundWebhook.channel_id)
          )
        )
        .where(
          and(
            eq(outboundWebhook.outbound_webhook_id, webhookId),
            eq(outboundWebhook.account_id, accountId),
            isNull(outboundWebhook.deleted_at)
          )
        )
        .for('update', { of: outboundWebhook })
        .limit(1)
        .execute();
      const webhook = webhookRows[0];
      if (!webhook) return 'not_found';

      const now = new Date().toISOString();
      if (!active) {
        await tx
          .update(outboundWebhook)
          .set({ status: 'inactive', updated_at: now })
          .where(eq(outboundWebhook.outbound_webhook_id, webhookId))
          .execute();
        return 'deactivated';
      }

      if (!webhook.channel_available) return 'channel_unavailable';

      const subscriptions = await tx
        .select({
          id: outboundWebhookSubscription.outbound_webhook_subscription_id,
        })
        .from(outboundWebhookSubscription)
        .where(
          and(
            eq(outboundWebhookSubscription.outbound_webhook_id, webhookId),
            eq(outboundWebhookSubscription.active, true),
            isNull(outboundWebhookSubscription.deleted_at)
          )
        )
        .limit(1)
        .execute();
      if (!subscriptions[0]) return 'no_events';

      const verification = await tx
        .select({ id: outboundWebhookDelivery.outbound_webhook_delivery_id })
        .from(outboundWebhookDelivery)
        .innerJoin(
          outboundWebhookEvent,
          eq(
            outboundWebhookEvent.outbound_webhook_event_id,
            outboundWebhookDelivery.outbound_webhook_event_id
          )
        )
        .where(
          and(
            eq(outboundWebhookDelivery.outbound_webhook_id, webhookId),
            eq(outboundWebhookDelivery.config_version, webhook.config_version),
            eq(outboundWebhookDelivery.status, 'succeeded'),
            eq(outboundWebhookEvent.is_test, true),
            eq(outboundWebhookEvent.event_type, 'webhook.test'),
            eq(outboundWebhookEvent.account_id, accountId),
            eq(outboundWebhookEvent.state, 'ready'),
            sql`${outboundWebhookEvent.payload} #>> '{data,verification,config_version}' = CAST(${webhook.config_version} AS text)`
          )
        )
        .limit(1)
        .execute();
      if (!verification[0]) return 'unverified';

      await tx
        .update(outboundWebhook)
        .set({
          status: 'active',
          consecutive_dead_deliveries: 0,
          suspended_at: null,
          suspension_reason: null,
          updated_at: now,
        })
        .where(eq(outboundWebhook.outbound_webhook_id, webhookId))
        .execute();
      return 'activated';
    });
  };

  findDeliveryForEvent = async (
    accountId: string,
    webhookId: string,
    eventId: string
  ): Promise<OutboundWebhookDeliveryRecord | null> => {
    const rows = await this.selectDeliveries(
      accountId,
      webhookId,
      [eq(outboundWebhookDelivery.outbound_webhook_event_id, eventId)],
      1
    );
    return rows[0] ?? null;
  };

  private selectDeliveries = async (
    accountId: string,
    webhookId: string,
    extraFilters: ReturnType<typeof eq>[],
    limit: number
  ): Promise<OutboundWebhookDeliveryRecord[]> => {
    return this.dbRw
      .select({
        outbound_webhook_delivery_id:
          outboundWebhookDelivery.outbound_webhook_delivery_id,
        outbound_webhook_id: outboundWebhookDelivery.outbound_webhook_id,
        outbound_webhook_event_id:
          outboundWebhookDelivery.outbound_webhook_event_id,
        event_type: outboundWebhookEvent.event_type,
        is_test: outboundWebhookEvent.is_test,
        config_version: outboundWebhookDelivery.config_version,
        status: outboundWebhookDelivery.status,
        attempt_count: outboundWebhookDelivery.attempt_count,
        response_status: sql<number | null>`(
          SELECT last_attempt.http_status
          FROM outbound_webhook_delivery_attempt AS last_attempt
          WHERE last_attempt.outbound_webhook_delivery_id =
            ${outboundWebhookDelivery.outbound_webhook_delivery_id}
          ORDER BY last_attempt.attempt_number DESC
          LIMIT 1
        )`.mapWith(outboundWebhookDeliveryAttempt.http_status),
        next_attempt_at: outboundWebhookDelivery.next_attempt_at,
        delivered_at: outboundWebhookDelivery.delivered_at,
        dead_at: outboundWebhookDelivery.dead_at,
        suppressed_at: outboundWebhookDelivery.suppressed_at,
        last_error: outboundWebhookDelivery.last_error,
        redelivery_of_delivery_id:
          outboundWebhookDelivery.redelivery_of_delivery_id,
        created_at: outboundWebhookDelivery.created_at,
        updated_at: outboundWebhookDelivery.updated_at,
      })
      .from(outboundWebhookDelivery)
      .innerJoin(
        outboundWebhook,
        eq(
          outboundWebhook.outbound_webhook_id,
          outboundWebhookDelivery.outbound_webhook_id
        )
      )
      .innerJoin(
        outboundWebhookEvent,
        eq(
          outboundWebhookEvent.outbound_webhook_event_id,
          outboundWebhookDelivery.outbound_webhook_event_id
        )
      )
      .where(
        and(
          eq(outboundWebhook.account_id, accountId),
          eq(outboundWebhook.outbound_webhook_id, webhookId),
          isNull(outboundWebhook.deleted_at),
          sql`${outboundWebhookDelivery.expires_at} > NOW()`,
          ...extraFilters
        )
      )
      .orderBy(
        desc(outboundWebhookDelivery.created_at),
        desc(outboundWebhookDelivery.outbound_webhook_delivery_id)
      )
      .limit(limit)
      .execute();
  };

  listDeliveries = async (
    accountId: string,
    webhookId: string,
    limit: number,
    cursor?: OutboundWebhookDeliveryCursor
  ): Promise<OutboundWebhookDeliveryRecord[]> => {
    const cursorFilter = cursor
      ? or(
          lt(outboundWebhookDelivery.created_at, cursor.createdAt),
          and(
            eq(outboundWebhookDelivery.created_at, cursor.createdAt),
            lt(
              outboundWebhookDelivery.outbound_webhook_delivery_id,
              cursor.deliveryId
            )
          )
        )
      : undefined;

    return this.selectDeliveries(
      accountId,
      webhookId,
      cursorFilter ? [cursorFilter] : [],
      limit
    );
  };

  findDeliveryById = async (
    accountId: string,
    webhookId: string,
    deliveryId: string
  ): Promise<OutboundWebhookDeliveryDetailRecord | null> => {
    const deliveryRows = await this.dbRw
      .select({
        outbound_webhook_delivery_id:
          outboundWebhookDelivery.outbound_webhook_delivery_id,
        outbound_webhook_id: outboundWebhookDelivery.outbound_webhook_id,
        outbound_webhook_event_id:
          outboundWebhookDelivery.outbound_webhook_event_id,
        event_type: outboundWebhookEvent.event_type,
        is_test: outboundWebhookEvent.is_test,
        config_version: outboundWebhookDelivery.config_version,
        status: outboundWebhookDelivery.status,
        attempt_count: outboundWebhookDelivery.attempt_count,
        response_status: sql<number | null>`(
          SELECT last_attempt.http_status
          FROM outbound_webhook_delivery_attempt AS last_attempt
          WHERE last_attempt.outbound_webhook_delivery_id =
            ${outboundWebhookDelivery.outbound_webhook_delivery_id}
          ORDER BY last_attempt.attempt_number DESC
          LIMIT 1
        )`.mapWith(outboundWebhookDeliveryAttempt.http_status),
        next_attempt_at: outboundWebhookDelivery.next_attempt_at,
        delivered_at: outboundWebhookDelivery.delivered_at,
        dead_at: outboundWebhookDelivery.dead_at,
        suppressed_at: outboundWebhookDelivery.suppressed_at,
        last_error: outboundWebhookDelivery.last_error,
        redelivery_of_delivery_id:
          outboundWebhookDelivery.redelivery_of_delivery_id,
        created_at: outboundWebhookDelivery.created_at,
        updated_at: outboundWebhookDelivery.updated_at,
        payload: outboundWebhookEvent.payload,
      })
      .from(outboundWebhookDelivery)
      .innerJoin(
        outboundWebhook,
        eq(
          outboundWebhook.outbound_webhook_id,
          outboundWebhookDelivery.outbound_webhook_id
        )
      )
      .innerJoin(
        outboundWebhookEvent,
        eq(
          outboundWebhookEvent.outbound_webhook_event_id,
          outboundWebhookDelivery.outbound_webhook_event_id
        )
      )
      .where(
        and(
          eq(outboundWebhookDelivery.outbound_webhook_delivery_id, deliveryId),
          eq(outboundWebhook.outbound_webhook_id, webhookId),
          eq(outboundWebhook.account_id, accountId),
          isNull(outboundWebhook.deleted_at),
          sql`${outboundWebhookDelivery.expires_at} > NOW()`
        )
      )
      .limit(1)
      .execute();
    const delivery = deliveryRows[0];
    if (!delivery) return null;

    const attempts = await this.dbRw
      .select({
        outbound_webhook_delivery_attempt_id:
          outboundWebhookDeliveryAttempt.outbound_webhook_delivery_attempt_id,
        attempt_number: outboundWebhookDeliveryAttempt.attempt_number,
        started_at: outboundWebhookDeliveryAttempt.started_at,
        finished_at: outboundWebhookDeliveryAttempt.finished_at,
        outcome: outboundWebhookDeliveryAttempt.outcome,
        http_status: outboundWebhookDeliveryAttempt.http_status,
        error_code: outboundWebhookDeliveryAttempt.error_code,
        error_message: outboundWebhookDeliveryAttempt.error_message,
        response_body: outboundWebhookDeliveryAttempt.response_body,
        duration_ms: outboundWebhookDeliveryAttempt.duration_ms,
        retry_after_ms: outboundWebhookDeliveryAttempt.retry_after_ms,
        created_at: outboundWebhookDeliveryAttempt.created_at,
      })
      .from(outboundWebhookDeliveryAttempt)
      .where(
        eq(
          outboundWebhookDeliveryAttempt.outbound_webhook_delivery_id,
          deliveryId
        )
      )
      .orderBy(asc(outboundWebhookDeliveryAttempt.attempt_number))
      .execute();

    return {
      ...delivery,
      payload: delivery.payload as unknown as Record<string, unknown>,
      attempts,
    };
  };

  redeliver = async (
    accountId: string,
    webhookId: string,
    deliveryId: string,
    requestedByUserId: string
  ): Promise<RedeliverOutboundWebhookRepositoryResult> => {
    return this.dbRw.transaction(async (tx) => {
      const webhookRows = await tx
        .select({
          status: outboundWebhook.status,
          config_version: outboundWebhook.config_version,
          channel_id: outboundWebhook.channel_id,
          channel_available: sql<boolean>`${worker.deleted_at} IS NULL`,
        })
        .from(outboundWebhook)
        .innerJoin(
          worker,
          and(
            eq(worker.account_id, outboundWebhook.account_id),
            eq(worker.worker_id, outboundWebhook.channel_id)
          )
        )
        .where(
          and(
            eq(outboundWebhook.outbound_webhook_id, webhookId),
            eq(outboundWebhook.account_id, accountId),
            isNull(outboundWebhook.deleted_at)
          )
        )
        .for('update', { of: outboundWebhook })
        .limit(1)
        .execute();
      const webhook = webhookRows[0];
      if (!webhook) return { status: 'not_found' };
      if (!webhook.channel_available) {
        return { status: 'channel_unavailable' };
      }
      if (webhook.status !== 'active') return { status: 'endpoint_inactive' };

      const deliveries = await tx
        .select({
          event_id: outboundWebhookDelivery.outbound_webhook_event_id,
          status: outboundWebhookDelivery.status,
          is_test: outboundWebhookEvent.is_test,
          entitlement_epoch_matches: sql<boolean>`
            ${outboundWebhookEvent.integration_entitlement_revision} IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM account_plan_product_entitlement_revision AS entitlement_revision
              WHERE entitlement_revision.account_id = ${accountId}
                AND entitlement_revision.plan_product_id = ${EPlanProduct.integration}
                AND entitlement_revision.allowed = TRUE
                AND (
                  entitlement_revision.deny_fence_token IS NULL
                  OR entitlement_revision.deny_fence_released_at IS NOT NULL
                )
                AND entitlement_revision.revision::text =
                  ${outboundWebhookEvent.integration_entitlement_revision}
            )
          `,
          entitlement_is_live: sql<boolean>`
            EXISTS (
              SELECT 1
              FROM account AS integration_account
              INNER JOIN LATERAL (
                SELECT
                  integration_plan_account.plan_id,
                  integration_plan_account.last_payment_date,
                  integration_plan_account.next_payment_date
                FROM plan_account AS integration_plan_account
                WHERE integration_plan_account.account_id =
                  integration_account.account_id
                ORDER BY
                  integration_plan_account.updated_at DESC NULLS LAST,
                  integration_plan_account.created_at DESC NULLS LAST,
                  integration_plan_account.plan_account_id DESC
                LIMIT 1
              ) AS current_integration_plan ON TRUE
              INNER JOIN plan AS integration_plan
                ON integration_plan.plan_id = current_integration_plan.plan_id
              WHERE integration_account.account_id = ${accountId}
                AND integration_account.account_status_id <>
                  ${EAccountStatus.blocked}
                AND integration_account.deleted_at IS NULL
                AND current_integration_plan.next_payment_date >
                  clock_timestamp()
                AND integration_plan.deleted_at IS NULL
                AND (
                  EXISTS (
                    SELECT 1
                    FROM plan_items AS integration_plan_item
                    WHERE integration_plan_item.plan_id =
                      current_integration_plan.plan_id
                      AND integration_plan_item.plan_product_id =
                        ${EPlanProduct.integration}
                      AND integration_plan_item.quantity > 0
                      AND integration_plan_item.deleted_at IS NULL
                  )
                  OR EXISTS (
                    SELECT 1
                    FROM plan_cross_sell_account AS integration_addon_account
                    INNER JOIN plan_cross_sell AS integration_addon
                      ON integration_addon.plan_cross_sell_id =
                        integration_addon_account.plan_cross_sell_id
                    WHERE integration_addon_account.account_id = ${accountId}
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
                  )
                )
            )
          `,
        })
        .from(outboundWebhookDelivery)
        .innerJoin(
          outboundWebhookEvent,
          eq(
            outboundWebhookEvent.outbound_webhook_event_id,
            outboundWebhookDelivery.outbound_webhook_event_id
          )
        )
        .where(
          and(
            eq(
              outboundWebhookDelivery.outbound_webhook_delivery_id,
              deliveryId
            ),
            eq(outboundWebhookDelivery.outbound_webhook_id, webhookId),
            inArray(outboundWebhookDelivery.status, ['dead', 'suppressed']),
            sql`${outboundWebhookDelivery.expires_at} > NOW()`,
            eq(outboundWebhookEvent.account_id, accountId),
            eq(outboundWebhookEvent.state, 'ready'),
            sql`${outboundWebhookEvent.expires_at} > NOW()`,
            sql`${webhook.channel_id} = ANY(${outboundWebhookEvent.routing_channel_ids})`,
            sql`EXISTS (
              SELECT 1
              FROM jsonb_array_elements(${outboundWebhookEvent.target_snapshot}) AS captured_target
              WHERE captured_target ->> 'webhook_id' = ${outboundWebhook.outbound_webhook_id}::text
                AND captured_target ->> 'channel_id' = ${outboundWebhook.channel_id}::text
            )`,
            sql`EXISTS (
              SELECT 1
              FROM outbound_webhook_subscription AS subscription
              WHERE subscription.outbound_webhook_id = ${webhookId}
                AND subscription.event_type = ${outboundWebhookEvent.event_type}
                AND subscription.active = TRUE
                AND subscription.deleted_at IS NULL
            )`
          )
        )
        .for('update')
        .limit(1)
        .execute();
      const original = deliveries[0];
      if (!original || original.is_test) {
        return { status: 'not_redeliverable' };
      }
      if (
        !original.entitlement_is_live ||
        !original.entitlement_epoch_matches
      ) {
        return { status: 'entitlement_epoch_mismatch' };
      }

      const newDeliveryId = uuidv7();
      // The event owns retention for all related deliveries and attempts. A
      // manual redelivery intentionally renews that complete audit graph.
      const retentionExpiresAt = sql`NOW() + INTERVAL '30 days'`;
      await tx
        .update(outboundWebhookEvent)
        .set({ expires_at: retentionExpiresAt })
        .where(
          and(
            eq(
              outboundWebhookEvent.outbound_webhook_event_id,
              original.event_id
            ),
            eq(outboundWebhookEvent.account_id, accountId)
          )
        )
        .execute();

      await tx
        .insert(outboundWebhookDelivery)
        .values({
          outbound_webhook_delivery_id: newDeliveryId,
          outbound_webhook_id: webhookId,
          outbound_webhook_event_id: original.event_id,
          config_version: webhook.config_version,
          status: 'pending',
          redelivery_of_delivery_id: deliveryId,
          requested_by_user_id: requestedByUserId,
          expires_at: retentionExpiresAt,
        })
        .execute();

      return {
        status: 'created',
        outbound_webhook_event_id: original.event_id,
        outbound_webhook_delivery_id: newDeliveryId,
      };
    });
  };
}
