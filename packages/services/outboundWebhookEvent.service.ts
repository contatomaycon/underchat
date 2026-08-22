import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '@core/models';
import {
  outboundWebhook,
  outboundWebhookDelivery,
  outboundWebhookEvent,
  outboundWebhookSubscription,
  worker,
  type OutboundWebhookTargetSnapshot,
} from '@core/models';
import {
  OUTBOUND_WEBHOOK_MAX_ENDPOINTS_PER_ACCOUNT,
  type OutboundWebhookEventType,
} from '@core/common/constants/outboundWebhookEvents';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { PlanEntitlementService } from '@core/services/planEntitlement.service';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementRevisionMismatchError,
} from '@core/common/exceptions/PlanEntitlementError';
import {
  PlanEntitlementRepository,
  type PlanEntitlementSource,
} from '@core/repositories/planEntitlement/PlanEntitlement.repository';
import {
  assertOutboundWebhookPayloadSize,
  buildOutboundWebhookEnvelope,
  normalizeOutboundWebhookChannelIds,
  type OutboundWebhookAggregate,
  type OutboundWebhookEnvelope,
} from '@core/common/functions/outboundWebhookPayload';
import {
  createPlanEntitlementAuditContext,
  getPlanEntitlementAuditSource,
  planEntitlementTelemetryStore,
} from '@core/services/planEntitlementTelemetryStore';
import {
  type CompleteOutboundWebhookEventInput,
  type OutboundWebhookEventServicePort,
  type PreparedOutboundWebhookEvent,
  type PrepareOutboundWebhookEventInput,
} from '@core/common/interfaces/IOutboundWebhookEventService';
import { workerErrorFailureReason } from '@core/common/functions/workerErrorDiagnostics';
export {
  OUTBOUND_WEBHOOK_EVENT_SERVICE_TOKEN,
  type CompleteOutboundWebhookEventInput,
  type PreparedOutboundWebhookEvent,
  type PrepareOutboundWebhookEventInput,
} from '@core/common/interfaces/IOutboundWebhookEventService';

interface CurrentIntegrationEntitlementAuditState {
  readonly revision: string;
  readonly source: PlanEntitlementSource;
}

interface CompletePersistedOutboundWebhookEventInput {
  eventId: string;
  accountId: string;
  targetWebhookId?: string;
}

interface RecordReadyOutboundWebhookEventInput extends PrepareOutboundWebhookEventInput {
  targetWebhookId?: string;
}

interface ExistingOutboundWebhookEventRow {
  eventId: string;
  payload: OutboundWebhookEnvelope;
  routingChannelIds: string[];
  state: PreparedOutboundWebhookEvent['state'];
  integrationEntitlementRevision: string | null;
}

const TEST_ENTITLEMENT_REVISION = 'test-entitlement-revision';

export function buildOutboundWebhookIdempotencyKey(
  ...parts: ReadonlyArray<string | number | boolean | null | undefined>
): string {
  return createHash('sha256')
    .update(parts.map((part) => String(part ?? '')).join('\u001f'), 'utf8')
    .digest('hex');
}

const outboundWebhookErrorMessage = (error: unknown): string =>
  workerErrorFailureReason('outbound_webhook_operation_failed', error);

const OUTBOUND_WEBHOOK_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Eligibility is evaluated in the same statement that captures recipients.
 * Keeping this predicate in the snapshot query prevents a fact produced while
 * an account or its latest plan is ineligible from becoming a delayed backfill
 * if eligibility changes before the dispatcher claims the delivery.
 */
const outboundWebhookAccountIsEligibleAtCapture = sql<boolean>`EXISTS (
  SELECT 1
  FROM account AS capture_account
  WHERE capture_account.account_id = ${outboundWebhook.account_id}
    AND capture_account.account_status_id <> ${EAccountStatus.blocked}
    AND capture_account.deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM (
        SELECT
          capture_plan_account.plan_id,
          capture_plan_account.next_payment_date
        FROM plan_account AS capture_plan_account
        WHERE capture_plan_account.account_id = ${outboundWebhook.account_id}
        ORDER BY
          capture_plan_account.updated_at DESC NULLS LAST,
          capture_plan_account.created_at DESC NULLS LAST,
          capture_plan_account.plan_account_id DESC
        LIMIT 1
      ) AS capture_latest_plan_account
      INNER JOIN plan AS capture_plan
        ON capture_plan.plan_id = capture_latest_plan_account.plan_id
      WHERE capture_latest_plan_account.next_payment_date > clock_timestamp()
        AND capture_plan.deleted_at IS NULL
    )
)`;

const normalizeOutboundWebhookTargetSnapshot = (
  value: unknown
): OutboundWebhookTargetSnapshot[] => {
  if (
    !Array.isArray(value) ||
    value.length > OUTBOUND_WEBHOOK_MAX_ENDPOINTS_PER_ACCOUNT
  ) {
    throw new Error('outbound_webhook_event_invalid_target_snapshot');
  }

  const targets = new Map<
    string,
    { channel_id: string; config_version: number }
  >();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('outbound_webhook_event_invalid_target_snapshot');
    }
    const target = item as Record<string, unknown>;
    const webhookId = target.webhook_id;
    const channelId = target.channel_id;
    const configVersion = target.config_version;
    if (
      typeof webhookId !== 'string' ||
      !OUTBOUND_WEBHOOK_ID_PATTERN.test(webhookId) ||
      typeof channelId !== 'string' ||
      !OUTBOUND_WEBHOOK_ID_PATTERN.test(channelId) ||
      !Number.isSafeInteger(configVersion) ||
      (configVersion as number) <= 0
    ) {
      throw new Error('outbound_webhook_event_invalid_target_snapshot');
    }
    const normalizedWebhookId = webhookId.toLowerCase();
    const normalizedChannelId = channelId.toLowerCase();
    const existingTarget = targets.get(normalizedWebhookId);
    if (
      existingTarget !== undefined &&
      (existingTarget.channel_id !== normalizedChannelId ||
        existingTarget.config_version !== configVersion)
    ) {
      throw new Error('outbound_webhook_event_invalid_target_snapshot');
    }
    targets.set(normalizedWebhookId, {
      channel_id: normalizedChannelId,
      config_version: configVersion as number,
    });
  }

  return [...targets.entries()]
    .map(([webhook_id, target]) => ({
      webhook_id,
      channel_id: target.channel_id,
      config_version: target.config_version,
    }))
    .sort((first, second) => first.webhook_id.localeCompare(second.webhook_id));
};

const assertOutboundWebhookEventAggregate = (
  eventType: OutboundWebhookEventType,
  aggregateType: OutboundWebhookAggregate['type']
): void => {
  let expectedAggregateType: OutboundWebhookAggregate['type'] | null = null;

  if (eventType.startsWith('chat.')) {
    expectedAggregateType = 'chat';
  } else if (eventType.startsWith('message.')) {
    expectedAggregateType = 'message';
  } else if (eventType.startsWith('contact.')) {
    expectedAggregateType = 'contact';
  } else if (eventType === 'webhook.test') {
    expectedAggregateType = 'webhook';
  }

  if (expectedAggregateType !== aggregateType) {
    throw new Error('outbound_webhook_event_type_aggregate_mismatch');
  }
};

const assertOutboundWebhookFrozenChannelScope = (input: {
  routingChannelIds: readonly string[];
  payload: OutboundWebhookEnvelope;
}): void => {
  const routingChannelIds = normalizeOutboundWebhookChannelIds(
    input.routingChannelIds
  );
  const envelopeChannelIds = normalizeOutboundWebhookChannelIds(
    input.payload.context?.channel_ids ?? []
  );
  if (
    envelopeChannelIds.join('\u001f') !==
      (input.payload.context?.channel_ids ?? []).join('\u001f') ||
    routingChannelIds.join('\u001f') !== envelopeChannelIds.join('\u001f')
  ) {
    throw new Error('outbound_webhook_event_channel_scope_mismatch');
  }
};

@injectable()
export class OutboundWebhookEventService implements OutboundWebhookEventServicePort {
  constructor(
    @inject('DatabaseRw')
    private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject(PlanEntitlementService)
    private readonly planEntitlementService: PlanEntitlementService | null = null,
    @inject(PlanEntitlementRepository)
    private readonly planEntitlementRepository: PlanEntitlementRepository | null = null
  ) {}

  private assertCurrentIntegrationEntitlement = async (
    accountId: string,
    expectedRevision?: string,
    bypassCache = false
  ): Promise<CurrentIntegrationEntitlementAuditState> => {
    if (!this.planEntitlementService && !this.planEntitlementRepository) {
      return {
        revision: expectedRevision ?? TEST_ENTITLEMENT_REVISION,
        source: null,
      };
    }

    try {
      if (!this.planEntitlementService && this.planEntitlementRepository) {
        const entitlement =
          await this.planEntitlementRepository.resolveEntitlement(
            accountId,
            EPlanProduct.integration
          );
        if (!entitlement.allowed) {
          throw new PlanEntitlementDeniedError(entitlement);
        }
        if (expectedRevision && entitlement.revision !== expectedRevision) {
          throw new PlanEntitlementRevisionMismatchError(
            entitlement,
            expectedRevision
          );
        }
        planEntitlementTelemetryStore.recordDecision(
          'outbound_capture',
          'allowed'
        );
        return {
          revision: entitlement.revision,
          source: entitlement.source,
        };
      }

      const planEntitlementService = this.planEntitlementService;
      if (!planEntitlementService) {
        return {
          revision: expectedRevision ?? TEST_ENTITLEMENT_REVISION,
          source: null,
        };
      }

      const entitlement = await planEntitlementService.assertEntitled(
        accountId,
        EPlanProduct.integration,
        {
          ...(expectedRevision ? { expectedRevision } : {}),
          bypassCache,
        }
      );
      planEntitlementTelemetryStore.recordDecision(
        'outbound_capture',
        'allowed'
      );
      return {
        revision: entitlement.revision,
        source: entitlement.source,
      };
    } catch (error) {
      if (
        error instanceof PlanEntitlementDeniedError ||
        error instanceof PlanEntitlementRevisionMismatchError
      ) {
        planEntitlementTelemetryStore.recordDecision(
          'outbound_capture',
          'denied'
        );
        planEntitlementTelemetryStore.recordSuppression(
          'outbound_capture',
          error instanceof PlanEntitlementRevisionMismatchError
            ? 'revision_mismatch'
            : 'integration_entitlement_missing'
        );
      } else {
        planEntitlementTelemetryStore.recordDecision(
          'outbound_capture',
          'unavailable'
        );
      }
      throw error;
    }
  };

  private normalizeCapturedEntitlementRevision = (
    revision: string | null | undefined
  ): string | null => {
    if (revision) return revision;
    return this.planEntitlementService ? null : TEST_ENTITLEMENT_REVISION;
  };

  /**
   * Journals a domain event without allowing webhook infrastructure to abort
   * the primary chat/contact mutation.
   */
  prepareBestEffort = async (
    input: PrepareOutboundWebhookEventInput
  ): Promise<PreparedOutboundWebhookEvent | null> => {
    try {
      return await this.prepare(input);
    } catch (error: unknown) {
      if (
        error instanceof PlanEntitlementDeniedError ||
        error instanceof PlanEntitlementRevisionMismatchError
      ) {
        /*
         * A missing Integration entitlement is an expected suppression, not
         * an outbound-webhook infrastructure failure. The entitlement layer
         * already records the denied decision and suppression telemetry; a
         * per-message error here only floods logs during normal traffic.
         */
        return null;
      }
      console.error('[OutboundWebhook] Unable to prepare domain event', {
        account_id: input.accountId,
        event_type: input.eventType,
        aggregate_type: input.aggregate.type,
        aggregate_id: input.aggregate.id,
        error: outboundWebhookErrorMessage(error),
      });
      return null;
    }
  };

  /**
   * Finalizes an already-applied domain event. On failure the row deliberately
   * remains `preparing`; chat/message markers let the reconciler finish it.
   */
  completeBestEffort = async (
    input: CompleteOutboundWebhookEventInput
  ): Promise<boolean> => {
    try {
      await this.complete(input);
      return true;
    } catch (error: unknown) {
      console.error('[OutboundWebhook] Unable to complete domain event', {
        account_id: input.accountId,
        event_id: input.eventId,
        event_type: input.envelope.type,
        aggregate_type: input.envelope.aggregate.type,
        aggregate_id: input.envelope.aggregate.id,
        error: outboundWebhookErrorMessage(error),
      });
      return false;
    }
  };

  /** Completes the exact envelope frozen by a transactional domain marker. */
  completePersistedBestEffort = async (
    input: CompletePersistedOutboundWebhookEventInput
  ): Promise<boolean> => {
    try {
      await this.completePersisted(input);
      return true;
    } catch (error: unknown) {
      console.error(
        '[OutboundWebhook] Unable to complete persisted domain event',
        {
          account_id: input.accountId,
          event_id: input.eventId,
          error: outboundWebhookErrorMessage(error),
        }
      );
      return false;
    }
  };

  private findExistingEvent = async (
    accountId: string,
    eventType: OutboundWebhookEventType,
    idempotencyKey: string
  ): Promise<ExistingOutboundWebhookEventRow | null> => {
    const rows = await this.dbRw
      .select({
        eventId: outboundWebhookEvent.outbound_webhook_event_id,
        payload: outboundWebhookEvent.payload,
        routingChannelIds: outboundWebhookEvent.routing_channel_ids,
        state: outboundWebhookEvent.state,
        integrationEntitlementRevision:
          outboundWebhookEvent.integration_entitlement_revision,
      })
      .from(outboundWebhookEvent)
      .where(
        and(
          eq(outboundWebhookEvent.account_id, accountId),
          eq(outboundWebhookEvent.event_type, eventType),
          eq(outboundWebhookEvent.idempotency_key, idempotencyKey)
        )
      )
      .limit(1)
      .execute();

    return rows[0] ?? null;
  };

  private captureTargetSnapshot = async (
    input: PrepareOutboundWebhookEventInput
  ): Promise<OutboundWebhookTargetSnapshot[]> => {
    if (input.eventType === 'webhook.test') {
      if (
        input.isTest !== true ||
        !input.targetWebhookId ||
        input.aggregate.type !== 'webhook' ||
        input.aggregate.id !== input.targetWebhookId
      ) {
        throw new Error('outbound_webhook_event_invalid_target');
      }

      const rows = await this.dbRw
        .select({
          webhook_id: outboundWebhook.outbound_webhook_id,
          channel_id: outboundWebhook.channel_id,
          config_version: outboundWebhook.config_version,
        })
        .from(outboundWebhook)
        .innerJoin(
          worker,
          and(
            eq(worker.worker_id, outboundWebhook.channel_id),
            eq(worker.account_id, outboundWebhook.account_id),
            isNull(worker.deleted_at)
          )
        )
        .where(
          and(
            eq(outboundWebhook.account_id, input.accountId),
            eq(outboundWebhook.outbound_webhook_id, input.targetWebhookId),
            inArray(outboundWebhook.channel_id, [...input.channelIds]),
            ...(input.targetConfigVersion === undefined
              ? []
              : [
                  eq(outboundWebhook.config_version, input.targetConfigVersion),
                ]),
            outboundWebhookAccountIsEligibleAtCapture,
            isNull(outboundWebhook.deleted_at)
          )
        )
        .limit(1)
        .execute();
      const snapshot = normalizeOutboundWebhookTargetSnapshot(rows);
      if (snapshot.length !== 1) {
        throw new Error('outbound_webhook_target_not_found');
      }
      return snapshot;
    }

    if (input.isTest === true || input.targetWebhookId) {
      throw new Error('outbound_webhook_event_invalid_target');
    }

    const rows = await this.dbRw
      .select({
        webhook_id: outboundWebhook.outbound_webhook_id,
        channel_id: outboundWebhook.channel_id,
        config_version: outboundWebhook.config_version,
      })
      .from(outboundWebhook)
      .innerJoin(
        worker,
        and(
          eq(worker.worker_id, outboundWebhook.channel_id),
          eq(worker.account_id, outboundWebhook.account_id),
          isNull(worker.deleted_at)
        )
      )
      .innerJoin(
        outboundWebhookSubscription,
        and(
          eq(
            outboundWebhookSubscription.outbound_webhook_id,
            outboundWebhook.outbound_webhook_id
          ),
          eq(outboundWebhookSubscription.event_type, input.eventType),
          eq(outboundWebhookSubscription.active, true),
          isNull(outboundWebhookSubscription.deleted_at)
        )
      )
      .where(
        and(
          eq(outboundWebhook.account_id, input.accountId),
          inArray(outboundWebhook.channel_id, [...input.channelIds]),
          eq(outboundWebhook.status, 'active'),
          outboundWebhookAccountIsEligibleAtCapture,
          isNull(outboundWebhook.deleted_at)
        )
      )
      .execute();

    return normalizeOutboundWebhookTargetSnapshot(rows);
  };

  prepare = async (
    input: PrepareOutboundWebhookEventInput
  ): Promise<PreparedOutboundWebhookEvent | null> => {
    assertOutboundWebhookEventAggregate(input.eventType, input.aggregate.type);
    const integrationEntitlement =
      await this.assertCurrentIntegrationEntitlement(input.accountId);
    const integrationEntitlementRevision = integrationEntitlement.revision;
    const idempotencyKey = buildOutboundWebhookIdempotencyKey(
      input.idempotencyKey
    );
    const existing = await this.findExistingEvent(
      input.accountId,
      input.eventType,
      idempotencyKey
    );
    if (existing?.state === 'quarantined') {
      throw new Error('outbound_webhook_event_quarantined');
    }
    if (existing && existing.state !== 'cancelled') {
      if (
        this.normalizeCapturedEntitlementRevision(
          existing.integrationEntitlementRevision
        ) !== integrationEntitlementRevision
      ) {
        throw new Error('outbound_webhook_event_entitlement_epoch_mismatch');
      }
      assertOutboundWebhookFrozenChannelScope(existing);
      console.info(
        '[PlanEntitlementAudit] Existing outbound webhook event admitted',
        createPlanEntitlementAuditContext({
          surface: 'outbound_capture',
          outcome: 'allowed',
          accountId: input.accountId,
          planProductId: EPlanProduct.integration,
          revision: integrationEntitlementRevision,
          source: integrationEntitlement.source,
          eventId: existing.eventId,
        })
      );
      return {
        eventId: existing.eventId,
        envelope: existing.payload,
        created: false,
        state: existing.state,
      };
    }

    const channelIds = normalizeOutboundWebhookChannelIds(input.channelIds);
    const normalizedInput: PrepareOutboundWebhookEventInput = {
      ...input,
      channelIds,
    };

    const targetSnapshot = await this.captureTargetSnapshot(normalizedInput);
    if (targetSnapshot.length === 0) return null;

    const eventId = existing?.eventId ?? input.eventId ?? uuidv7();
    let envelope: OutboundWebhookEnvelope;
    try {
      envelope = buildOutboundWebhookEnvelope({
        id: eventId,
        type: input.eventType,
        occurredAt: input.occurredAt,
        accountId: input.accountId,
        aggregate: input.aggregate,
        data: input.data,
        previous: input.previous,
        source: input.source,
        channelIds,
        actor: input.actor,
      });
    } catch (error: unknown) {
      if (
        !(error instanceof Error) ||
        error.message !== 'outbound_webhook_payload_too_large'
      ) {
        throw error;
      }
      console.warn('[OutboundWebhook] Domain event payload was compacted', {
        account_id: input.accountId,
        event_type: input.eventType,
        aggregate_type: input.aggregate.type,
        aggregate_id: input.aggregate.id,
      });
      envelope = buildOutboundWebhookEnvelope({
        id: eventId,
        type: input.eventType,
        occurredAt: input.occurredAt,
        accountId: input.accountId,
        aggregate: input.aggregate,
        data: {
          payload_omitted: true,
          omission_reason: 'payload_too_large',
        },
        previous: null,
        source: input.source,
        channelIds,
        actor: input.actor,
      });
    }
    const occurredAt = envelope.occurred_at;

    if (existing?.state === 'cancelled') {
      const revivalEntitlement = await this.assertCurrentIntegrationEntitlement(
        input.accountId,
        integrationEntitlementRevision,
        true
      );
      const revived = await this.dbRw
        .update(outboundWebhookEvent)
        .set({
          state: 'preparing',
          payload: envelope,
          routing_channel_ids: channelIds,
          target_snapshot: targetSnapshot,
          source: input.source,
          integration_entitlement_revision: integrationEntitlementRevision,
          occurred_at: occurredAt,
          created_at: new Date().toISOString(),
          expires_at: sql`NOW() + INTERVAL '30 days'`,
          domain_applied_at: null,
          cancelled_at: null,
          ready_at: null,
        })
        .where(
          and(
            eq(outboundWebhookEvent.outbound_webhook_event_id, eventId),
            eq(outboundWebhookEvent.state, 'cancelled')
          )
        )
        .returning({ id: outboundWebhookEvent.outbound_webhook_event_id })
        .execute();
      if (revived[0]) {
        console.info(
          '[PlanEntitlementAudit] Outbound webhook event revival admitted',
          createPlanEntitlementAuditContext({
            surface: 'outbound_capture',
            outcome: 'allowed',
            accountId: input.accountId,
            planProductId: EPlanProduct.integration,
            revision: revivalEntitlement.revision,
            source: revivalEntitlement.source,
            eventId,
          })
        );
        return {
          eventId,
          envelope,
          created: false,
          state: 'preparing',
        };
      }
      return this.prepare({ ...normalizedInput, eventId });
    }

    // Target discovery and event persistence are separate database statements.
    // Recheck the captured epoch at the persistence boundary so a downgrade
    // that happened while the snapshot was being built cannot create work for
    // the old grant.
    const persistenceEntitlement =
      await this.assertCurrentIntegrationEntitlement(
        input.accountId,
        integrationEntitlementRevision,
        true
      );
    const inserted = await this.dbRw
      .insert(outboundWebhookEvent)
      .values({
        outbound_webhook_event_id: eventId,
        account_id: input.accountId,
        event_type: input.eventType,
        state: 'preparing',
        aggregate_type: input.aggregate.type,
        aggregate_id: input.aggregate.id,
        payload: envelope,
        routing_channel_ids: channelIds,
        target_snapshot: targetSnapshot,
        idempotency_key: idempotencyKey,
        is_test: input.isTest ?? false,
        source: input.source,
        integration_entitlement_revision: integrationEntitlementRevision,
        occurred_at: occurredAt,
      })
      .onConflictDoNothing({
        target: [
          outboundWebhookEvent.account_id,
          outboundWebhookEvent.event_type,
          outboundWebhookEvent.idempotency_key,
        ],
      })
      .returning({
        eventId: outboundWebhookEvent.outbound_webhook_event_id,
        state: outboundWebhookEvent.state,
      })
      .execute();

    if (inserted[0]) {
      console.info(
        '[PlanEntitlementAudit] Outbound webhook event captured',
        createPlanEntitlementAuditContext({
          surface: 'outbound_capture',
          outcome: 'allowed',
          accountId: input.accountId,
          planProductId: EPlanProduct.integration,
          revision: persistenceEntitlement.revision,
          source: persistenceEntitlement.source,
          eventId: inserted[0].eventId,
        })
      );
      return {
        eventId: inserted[0].eventId,
        envelope,
        created: true,
        state: inserted[0].state,
      };
    }

    const conflicted = await this.findExistingEvent(
      input.accountId,
      input.eventType,
      idempotencyKey
    );
    if (!conflicted) {
      throw new Error('outbound_webhook_event_prepare_conflict');
    }
    if (conflicted.state === 'quarantined') {
      throw new Error('outbound_webhook_event_quarantined');
    }
    if (conflicted.state === 'cancelled') {
      return this.prepare({
        ...normalizedInput,
        eventId: conflicted.eventId,
      });
    }

    if (
      this.normalizeCapturedEntitlementRevision(
        conflicted.integrationEntitlementRevision
      ) !== integrationEntitlementRevision
    ) {
      throw new Error('outbound_webhook_event_entitlement_epoch_mismatch');
    }

    assertOutboundWebhookFrozenChannelScope(conflicted);

    console.info(
      '[PlanEntitlementAudit] Concurrent outbound webhook event admitted',
      createPlanEntitlementAuditContext({
        surface: 'outbound_capture',
        outcome: 'allowed',
        accountId: input.accountId,
        planProductId: EPlanProduct.integration,
        revision: persistenceEntitlement.revision,
        source: persistenceEntitlement.source,
        eventId: conflicted.eventId,
      })
    );

    return {
      eventId: conflicted.eventId,
      envelope: conflicted.payload,
      created: false,
      state: conflicted.state,
    };
  };

  complete = async (
    input: CompleteOutboundWebhookEventInput
  ): Promise<'ready' | 'discarded'> => {
    assertOutboundWebhookPayloadSize(input.envelope);
    assertOutboundWebhookEventAggregate(
      input.envelope.type,
      input.envelope.aggregate.type
    );
    if (
      input.envelope.id !== input.eventId ||
      input.envelope.account_id !== input.accountId
    ) {
      throw new Error('outbound_webhook_event_envelope_identity_mismatch');
    }

    return this.dbRw.transaction(async (tx) => {
      const eventRows = await tx
        .select({
          eventType: outboundWebhookEvent.event_type,
          isTest: outboundWebhookEvent.is_test,
          state: outboundWebhookEvent.state,
          aggregateType: outboundWebhookEvent.aggregate_type,
          aggregateId: outboundWebhookEvent.aggregate_id,
          routingChannelIds: outboundWebhookEvent.routing_channel_ids,
          targetSnapshot: outboundWebhookEvent.target_snapshot,
          integrationEntitlementRevision:
            outboundWebhookEvent.integration_entitlement_revision,
        })
        .from(outboundWebhookEvent)
        .where(
          and(
            eq(outboundWebhookEvent.outbound_webhook_event_id, input.eventId),
            eq(outboundWebhookEvent.account_id, input.accountId)
          )
        )
        .for('update')
        .limit(1)
        .execute();

      const event = eventRows[0];
      if (!event) {
        throw new Error('outbound_webhook_event_not_found');
      }
      if (event.eventType !== input.envelope.type) {
        throw new Error('outbound_webhook_event_type_mismatch');
      }
      if (
        event.aggregateType !== input.envelope.aggregate.type ||
        event.aggregateId !== input.envelope.aggregate.id
      ) {
        throw new Error('outbound_webhook_event_aggregate_mismatch');
      }
      const routingChannelIds = normalizeOutboundWebhookChannelIds(
        event.routingChannelIds
      );
      const envelopeChannelIds = normalizeOutboundWebhookChannelIds(
        input.envelope.context?.channel_ids ?? []
      );
      if (
        envelopeChannelIds.join('\u001f') !==
          (input.envelope.context?.channel_ids ?? []).join('\u001f') ||
        routingChannelIds.join('\u001f') !== envelopeChannelIds.join('\u001f')
      ) {
        throw new Error('outbound_webhook_event_channel_scope_mismatch');
      }
      if (event.state === 'cancelled' || event.state === 'quarantined') {
        throw new Error(`outbound_webhook_event_${event.state}`);
      }
      if (event.state === 'discarded') {
        return 'discarded';
      }

      const discardForEntitlement = async (
        reason: 'integration_entitlement_missing',
        audit: {
          readonly revision: string | null;
          readonly source: PlanEntitlementSource;
        }
      ): Promise<'discarded'> => {
        console.warn(
          '[PlanEntitlementAudit] Outbound webhook event suppressed',
          createPlanEntitlementAuditContext({
            surface: 'outbound_capture',
            outcome: 'denied',
            accountId: input.accountId,
            planProductId: EPlanProduct.integration,
            revision: audit.revision,
            source: audit.source,
            eventId: input.eventId,
            reason,
          })
        );
        const discardedAt = new Date().toISOString();
        await tx
          .update(outboundWebhookEvent)
          .set({
            state: 'discarded',
            payload: {
              ...input.envelope,
              data: { discarded: true, reason },
              previous: null,
            },
          })
          .where(
            and(
              eq(outboundWebhookEvent.outbound_webhook_event_id, input.eventId),
              inArray(outboundWebhookEvent.state, ['preparing', 'ready'])
            )
          )
          .execute();
        await tx
          .update(outboundWebhookDelivery)
          .set({
            status: 'suppressed',
            suppressed_at: discardedAt,
            lease_token: null,
            lease_expires_at: null,
            last_error: reason,
            updated_at: discardedAt,
          })
          .where(
            and(
              eq(
                outboundWebhookDelivery.outbound_webhook_event_id,
                input.eventId
              ),
              inArray(outboundWebhookDelivery.status, ['pending', 'retrying'])
            )
          )
          .execute();
        return 'discarded';
      };

      const capturedEntitlementRevision =
        this.normalizeCapturedEntitlementRevision(
          event.integrationEntitlementRevision
        );
      if (!capturedEntitlementRevision) {
        planEntitlementTelemetryStore.recordDecision(
          'outbound_capture',
          'denied'
        );
        planEntitlementTelemetryStore.recordSuppression(
          'outbound_capture',
          'legacy_revision_missing'
        );
        return discardForEntitlement('integration_entitlement_missing', {
          revision: event.integrationEntitlementRevision,
          source: null,
        });
      }
      try {
        const completionEntitlement =
          await this.assertCurrentIntegrationEntitlement(
            input.accountId,
            capturedEntitlementRevision,
            true
          );
        console.info(
          '[PlanEntitlementAudit] Outbound webhook completion admitted',
          createPlanEntitlementAuditContext({
            surface: 'outbound_capture',
            outcome: 'allowed',
            accountId: input.accountId,
            planProductId: EPlanProduct.integration,
            revision: completionEntitlement.revision,
            source: completionEntitlement.source,
            eventId: input.eventId,
          })
        );
      } catch (error) {
        if (
          error instanceof PlanEntitlementDeniedError ||
          error instanceof PlanEntitlementRevisionMismatchError
        ) {
          return discardForEntitlement('integration_entitlement_missing', {
            revision: error.entitlement.revision,
            source: getPlanEntitlementAuditSource(error.entitlement),
          });
        }
        throw error;
      }
      if (
        input.targetWebhookId &&
        (!event.isTest ||
          event.eventType !== 'webhook.test' ||
          input.envelope.aggregate.type !== 'webhook' ||
          input.envelope.aggregate.id !== input.targetWebhookId)
      ) {
        throw new Error('outbound_webhook_event_invalid_target');
      }

      // The delivery fan-out belongs to the atomic preparing -> ready
      // transition. Replaying an idempotent producer after the event is ready
      // must not deliver that historical fact to endpoints created later.
      if (event.state === 'ready') {
        return 'ready';
      }

      await tx
        .update(outboundWebhookEvent)
        .set({
          state: 'ready',
          payload: input.envelope,
          ready_at: new Date().toISOString(),
          cancelled_at: null,
        })
        .where(
          and(
            eq(outboundWebhookEvent.outbound_webhook_event_id, input.eventId),
            eq(outboundWebhookEvent.state, 'preparing')
          )
        )
        .execute();

      const capturedTargets = normalizeOutboundWebhookTargetSnapshot(
        event.targetSnapshot
      );
      if (
        input.targetWebhookId &&
        (capturedTargets.length !== 1 ||
          capturedTargets[0]?.webhook_id !== input.targetWebhookId)
      ) {
        throw new Error('outbound_webhook_event_invalid_target_snapshot');
      }

      const capturedIds = capturedTargets.map((target) => target.webhook_id);
      const existingTargets =
        capturedIds.length === 0
          ? []
          : await tx
              .select({
                webhookId: outboundWebhook.outbound_webhook_id,
                channelId: outboundWebhook.channel_id,
              })
              .from(outboundWebhook)
              .innerJoin(
                worker,
                and(
                  eq(worker.worker_id, outboundWebhook.channel_id),
                  eq(worker.account_id, outboundWebhook.account_id),
                  isNull(worker.deleted_at)
                )
              )
              .where(
                and(
                  eq(outboundWebhook.account_id, input.accountId),
                  inArray(outboundWebhook.outbound_webhook_id, capturedIds),
                  inArray(outboundWebhook.channel_id, routingChannelIds),
                  isNull(outboundWebhook.deleted_at)
                )
              )
              .for('key share')
              .execute();
      const existingIds = new Set(
        existingTargets.map(
          (target) =>
            `${target.webhookId.toLowerCase()}\u001f${target.channelId.toLowerCase()}`
        )
      );
      const targets = capturedTargets
        .filter((target) =>
          existingIds.has(`${target.webhook_id}\u001f${target.channel_id}`)
        )
        .map((target) => ({
          webhookId: target.webhook_id,
          configVersion: target.config_version,
        }));

      if (input.targetWebhookId && targets.length === 0) {
        throw new Error('outbound_webhook_target_not_found');
      }

      if (targets.length === 0) {
        await tx
          .update(outboundWebhookEvent)
          .set({
            state: 'discarded',
            payload: {
              ...input.envelope,
              data: { discarded: true },
              previous: null,
            },
          })
          .where(
            and(
              eq(outboundWebhookEvent.outbound_webhook_event_id, input.eventId),
              eq(outboundWebhookEvent.state, 'ready')
            )
          )
          .execute();
        return 'discarded';
      }

      await tx
        .insert(outboundWebhookDelivery)
        .values(
          targets.map((target) => ({
            outbound_webhook_delivery_id: uuidv7(),
            outbound_webhook_id: target.webhookId,
            outbound_webhook_event_id: input.eventId,
            config_version: target.configVersion,
            status: 'pending' as const,
          }))
        )
        .onConflictDoNothing()
        .execute();

      return 'ready';
    });
  };

  completePersisted = async (
    input: CompletePersistedOutboundWebhookEventInput
  ): Promise<'ready' | 'discarded'> => {
    const rows = await this.dbRw
      .select({ envelope: outboundWebhookEvent.payload })
      .from(outboundWebhookEvent)
      .where(
        and(
          eq(outboundWebhookEvent.outbound_webhook_event_id, input.eventId),
          eq(outboundWebhookEvent.account_id, input.accountId)
        )
      )
      .limit(1)
      .execute();
    const envelope = rows[0]?.envelope;
    if (!envelope) throw new Error('outbound_webhook_event_not_found');

    return this.complete({
      ...input,
      envelope,
    });
  };

  recordReady = async (
    input: RecordReadyOutboundWebhookEventInput
  ): Promise<PreparedOutboundWebhookEvent> => {
    const prepared = await this.prepare(input);

    if (!prepared) {
      throw new Error('outbound_webhook_event_no_target');
    }

    if (prepared.state === 'cancelled' || prepared.state === 'quarantined') {
      throw new Error(`outbound_webhook_event_${prepared.state}`);
    }
    if (prepared.state === 'discarded') {
      return prepared;
    }

    const completedState = await this.complete({
      eventId: prepared.eventId,
      accountId: input.accountId,
      envelope: prepared.envelope,
      targetWebhookId: input.targetWebhookId,
    });

    return { ...prepared, state: completedState };
  };

  cancel = async (eventId: string): Promise<void> => {
    await this.dbRw
      .update(outboundWebhookEvent)
      .set({
        state: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(outboundWebhookEvent.outbound_webhook_event_id, eventId),
          eq(outboundWebhookEvent.state, 'preparing')
        )
      )
      .execute();
  };

  quarantine = async (eventId: string): Promise<void> => {
    await this.dbRw
      .update(outboundWebhookEvent)
      .set({ state: 'quarantined' })
      .where(
        and(
          eq(outboundWebhookEvent.outbound_webhook_event_id, eventId),
          eq(outboundWebhookEvent.state, 'preparing')
        )
      )
      .execute();
  };
}
