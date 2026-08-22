import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import type * as schema from '@core/models';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import {
  serializePublicContact,
  type OutboundWebhookEnvelope,
  type OutboundWebhookJsonValue,
} from '@core/common/functions/outboundWebhookPayload';
import { OutboundWebhookEventService } from '@core/services/outboundWebhookEvent.service';
import {
  PlanEntitlementRepository,
  type PlanEntitlementSource,
} from '@core/repositories/planEntitlement/PlanEntitlement.repository';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  createPlanEntitlementAuditContext,
  planEntitlementTelemetryStore,
} from '@core/services/planEntitlementTelemetryStore';

const STALE_AFTER_MS = 60_000;
const QUARANTINE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

interface RecoverableEventRow {
  outbound_webhook_event_id: string;
  account_id: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: OutboundWebhookEnvelope;
  domain_applied_at: string | Date | null;
  created_at: string | Date;
  integration_entitlement_revision: string | null;
}

interface RecoveryScanCursor {
  createdAt: string;
  eventId: string;
}

interface RecoveryEntitlementAuditState {
  readonly allowed: boolean;
  readonly revision: string | null;
  readonly source: PlanEntitlementSource;
}

type PublicRecord = Record<string, OutboundWebhookJsonValue>;

export interface OutboundWebhookRecoveryResult {
  scanned: number;
  recovered: number;
  quarantined: number;
  pending: number;
  failed: number;
  suppressed: number;
}

const rowsOf = <TRow>(result: unknown): TRow[] => {
  if (!result || typeof result !== 'object' || !('rows' in result)) return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as TRow[]) : [];
};

/**
 * Recovers journal intents after a process dies between the aggregate write and
 * event fan-out. Transactional producers persist `domain_applied_at` and the
 * final envelope in the same PostgreSQL transaction as their domain mutation.
 * Rows created before that marker existed retain the legacy snapshot proof.
 */
export class OutboundWebhookEventRecoveryService {
  private readonly entitlementRepository: PlanEntitlementRepository;
  private scanCursor: RecoveryScanCursor | null = null;

  constructor(
    private readonly dbRw: NodePgDatabase<typeof schema>,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly eventService: OutboundWebhookEventService | null = null,
    entitlementRepository?: PlanEntitlementRepository
  ) {
    this.entitlementRepository =
      entitlementRepository ?? new PlanEntitlementRepository(dbRw);
  }

  reconcile = async (
    limit = 100,
    now = new Date()
  ): Promise<OutboundWebhookRecoveryResult> => {
    const eventService = this.eventService;
    if (!eventService) {
      throw new Error('outbound_webhook_recovery_event_service_required');
    }
    const scanLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
    const cursorFilter = this.scanCursor
      ? sql`AND (
          created_at,
          outbound_webhook_event_id
        ) > (
          CAST(${this.scanCursor.createdAt} AS timestamptz),
          CAST(${this.scanCursor.eventId} AS uuid)
        )`
      : sql``;
    const result = await this.dbRw.execute(sql`
      SELECT
        outbound_webhook_event_id,
        account_id,
        aggregate_type,
        aggregate_id,
        payload,
        domain_applied_at,
        integration_entitlement_revision,
        created_at
      FROM outbound_webhook_event
      WHERE state = 'preparing'
        AND created_at <= CAST(${staleBefore} AS timestamptz)
        AND expires_at > CAST(${now.toISOString()} AS timestamptz)
        ${cursorFilter}
      ORDER BY created_at ASC, outbound_webhook_event_id ASC
      LIMIT ${scanLimit}
    `);
    const rows = rowsOf<RecoverableEventRow>(result);
    const lastRow = rows.at(-1);
    this.scanCursor =
      rows.length === scanLimit && lastRow
        ? {
            createdAt: new Date(lastRow.created_at).toISOString(),
            eventId: lastRow.outbound_webhook_event_id,
          }
        : null;
    const summary: OutboundWebhookRecoveryResult = {
      scanned: rows.length,
      recovered: 0,
      quarantined: 0,
      pending: 0,
      failed: 0,
      suppressed: 0,
    };

    for (const row of rows) {
      try {
        const entitlement =
          await this.resolveCurrentIntegrationEntitlement(row);
        if (!entitlement.allowed) {
          await this.suppressForMissingIntegrationEntitlement(row, entitlement);
          summary.suppressed += 1;
          continue;
        }
        console.info(
          '[PlanEntitlementAudit] Outbound webhook recovery admitted event',
          createPlanEntitlementAuditContext({
            surface: 'outbound_recovery',
            outcome: 'allowed',
            accountId: row.account_id,
            planProductId: EPlanProduct.integration,
            revision: entitlement.revision,
            source: entitlement.source,
            eventId: row.outbound_webhook_event_id,
          })
        );
        const hasTransactionalMarker =
          row.domain_applied_at !== null && row.domain_applied_at !== undefined;
        const applied = hasTransactionalMarker
          ? true
          : await this.hasAppliedMarker(row);
        if (applied) {
          await eventService.complete({
            eventId: row.outbound_webhook_event_id,
            accountId: row.account_id,
            envelope: row.payload,
          });
          summary.recovered += 1;
          continue;
        }

        const ageMs = now.getTime() - new Date(row.created_at).getTime();
        if (ageMs >= QUARANTINE_AFTER_MS) {
          await eventService.quarantine(row.outbound_webhook_event_id);
          summary.quarantined += 1;
        } else {
          summary.pending += 1;
        }
      } catch {
        summary.failed += 1;
      }
    }

    return summary;
  };

  private resolveCurrentIntegrationEntitlement = async (
    event: RecoverableEventRow
  ): Promise<RecoveryEntitlementAuditState> => {
    if (!event.integration_entitlement_revision) {
      planEntitlementTelemetryStore.recordDecision(
        'outbound_recovery',
        'denied'
      );
      planEntitlementTelemetryStore.recordSuppression(
        'outbound_recovery',
        'legacy_revision_missing'
      );
      return { allowed: false, revision: null, source: null };
    }

    try {
      const entitlement = await this.entitlementRepository.resolveEntitlement(
        event.account_id,
        EPlanProduct.integration
      );
      const allowed =
        entitlement.allowed &&
        entitlement.revision === event.integration_entitlement_revision;
      planEntitlementTelemetryStore.recordDecision(
        'outbound_recovery',
        allowed ? 'allowed' : 'denied'
      );
      if (!allowed) {
        planEntitlementTelemetryStore.recordSuppression(
          'outbound_recovery',
          entitlement.allowed
            ? 'revision_mismatch'
            : 'integration_entitlement_missing'
        );
      }
      return {
        allowed,
        revision: entitlement.revision,
        source: entitlement.source,
      };
    } catch (error) {
      planEntitlementTelemetryStore.recordDecision(
        'outbound_recovery',
        'unavailable'
      );
      throw error;
    }
  };

  private suppressForMissingIntegrationEntitlement = async (
    event: RecoverableEventRow,
    entitlement: RecoveryEntitlementAuditState
  ): Promise<void> => {
    console.warn(
      '[PlanEntitlementAudit] Outbound webhook recovery suppressed event',
      createPlanEntitlementAuditContext({
        surface: 'outbound_recovery',
        outcome: 'denied',
        accountId: event.account_id,
        planProductId: EPlanProduct.integration,
        revision: entitlement.revision,
        source: entitlement.source,
        eventId: event.outbound_webhook_event_id,
        reason: 'integration_entitlement_missing',
      })
    );
    await this.dbRw.transaction(async (transaction) => {
      await transaction.execute(sql`
        UPDATE outbound_webhook_event
        SET
          state = 'discarded',
          payload = jsonb_set(
            jsonb_set(payload, '{data}', ${JSON.stringify({
              discarded: true,
              reason: 'integration_entitlement_missing',
            })}::jsonb, TRUE),
            '{previous}',
            'null'::jsonb,
            TRUE
          )
        WHERE outbound_webhook_event_id = ${event.outbound_webhook_event_id}::uuid
          AND account_id = ${event.account_id}::uuid
          AND state = 'preparing'
      `);
      await transaction.execute(sql`
        UPDATE outbound_webhook_delivery
        SET
          status = 'suppressed',
          suppressed_at = clock_timestamp(),
          lease_token = NULL,
          lease_expires_at = NULL,
          last_error = 'integration_entitlement_missing',
          updated_at = clock_timestamp()
        WHERE outbound_webhook_event_id = ${event.outbound_webhook_event_id}::uuid
          AND status IN ('pending', 'retrying', 'leased')
      `);
    });
  };

  private hasAppliedMarker = async (
    event: RecoverableEventRow
  ): Promise<boolean> => {
    if (event.aggregate_type === 'chat') {
      const chat = await this.elasticDatabaseService.getById<IChat>(
        EElasticIndex.chat,
        event.aggregate_id
      );
      return Boolean(
        chat?.account?.id === event.account_id &&
        chat.meta?.outbound_webhook_event_ids?.includes(
          event.outbound_webhook_event_id
        )
      );
    }

    if (event.aggregate_type === 'message') {
      const message = await this.elasticDatabaseService.getById<IChatMessage>(
        EElasticIndex.message,
        event.aggregate_id
      );
      return Boolean(
        message?.account?.id === event.account_id &&
        message.outbound_webhook_event_ids?.includes(
          event.outbound_webhook_event_id
        )
      );
    }

    if (event.aggregate_type === 'contact') {
      return this.hasAppliedContactMutation(event);
    }

    return false;
  };

  private hasAppliedContactMutation = async (
    event: RecoverableEventRow
  ): Promise<boolean> => {
    if (
      event.payload.type !== 'contact.created' &&
      event.payload.type !== 'contact.updated' &&
      event.payload.type !== 'contact.deleted'
    ) {
      return false;
    }

    const result = await this.dbRw.execute(sql`
      SELECT
        contact_id,
        account_id,
        name,
        last_name,
        email_partial,
        phone_ddi,
        phone_partial,
        nickname,
        photo,
        birthday,
        notes,
        document_partial,
        contact_document_type_id,
        user_id,
        ignore,
        is_valided,
        created_at,
        updated_at,
        deleted_at,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'label_template_id', label.label_template_id,
              'label', label.label,
              'color', label.color
            )
            ORDER BY label.label_template_id
          )
          FROM contact_label_template AS contact_label
          INNER JOIN label_template AS label
            ON label.label_template_id = contact_label.label_template_id
          WHERE contact_label.contact_id = contact.contact_id
            AND label.account_id = contact.account_id
            AND label.deleted_at IS NULL
        ), '[]'::jsonb) AS label_templates,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'contact_group_id', contact_group.contact_group_id,
              'name', contact_group.name
            )
            ORDER BY contact_group.contact_group_id
          )
          FROM contact_group_assignment AS assignment
          INNER JOIN contact_group
            ON contact_group.contact_group_id = assignment.contact_group_id
          WHERE assignment.contact_id = contact.contact_id
            AND contact_group.account_id = contact.account_id
            AND contact_group.deleted_at IS NULL
        ), '[]'::jsonb) AS contact_groups,
        COALESCE((
          SELECT jsonb_agg(channel.channel_id ORDER BY channel.channel_id)
          FROM contact_channel AS channel
          WHERE channel.contact_id = contact.contact_id
            AND channel.account_id = contact.account_id
        ), '[]'::jsonb) AS channel_ids
      FROM contact
      WHERE contact_id = CAST(${event.aggregate_id} AS uuid)
        AND account_id = CAST(${event.account_id} AS uuid)
      LIMIT 1
    `);
    const contact = rowsOf<Record<string, unknown>>(result)[0];
    if (!contact) return false;
    if (event.payload.type === 'contact.created') {
      return contact.deleted_at === null;
    }
    if (event.payload.type === 'contact.deleted') {
      return contact.deleted_at !== null && contact.deleted_at !== undefined;
    }
    if (contact.deleted_at !== null) return false;

    const intended = this.asPublicRecord(event.payload.data.contact);
    const previous = this.asPublicRecord(event.payload.previous?.contact);
    if (!intended || !previous) return false;

    const canonical = serializePublicContact(contact);
    const changedKeys = Object.keys(intended).filter(
      (key) => !this.publicValuesEqual(intended[key], previous[key])
    );
    return (
      changedKeys.length > 0 &&
      changedKeys.every((key) =>
        this.publicValueMatches(canonical[key], intended[key])
      )
    );
  };

  private asPublicRecord(value: unknown): PublicRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as PublicRecord)
      : null;
  }

  private publicValuesEqual(
    first: OutboundWebhookJsonValue | undefined,
    second: OutboundWebhookJsonValue | undefined
  ): boolean {
    if (first === second) return true;
    if (Array.isArray(first) || Array.isArray(second)) {
      if (!Array.isArray(first) || !Array.isArray(second)) return false;
      return (
        first.length === second.length &&
        first.every((item, index) =>
          this.publicValuesEqual(item, second[index])
        )
      );
    }
    if (
      first &&
      second &&
      typeof first === 'object' &&
      typeof second === 'object'
    ) {
      const firstKeys = Object.keys(first);
      const secondKeys = Object.keys(second);
      return (
        firstKeys.length === secondKeys.length &&
        firstKeys.every((key) =>
          this.publicValuesEqual(first[key], second[key])
        )
      );
    }
    return false;
  }

  private publicValueMatches(
    actual: OutboundWebhookJsonValue | undefined,
    expected: OutboundWebhookJsonValue | undefined
  ): boolean {
    if (actual === expected) return true;
    if (Array.isArray(actual) || Array.isArray(expected)) {
      if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
      if (actual.length !== expected.length) return false;
      const unmatched = [...actual];
      return expected.every((expectedItem) => {
        const index = unmatched.findIndex((actualItem) =>
          this.publicValueMatches(actualItem, expectedItem)
        );
        if (index < 0) return false;
        unmatched.splice(index, 1);
        return true;
      });
    }
    if (
      actual &&
      expected &&
      typeof actual === 'object' &&
      typeof expected === 'object'
    ) {
      return Object.keys(expected).every((key) =>
        this.publicValueMatches(actual[key], expected[key])
      );
    }
    return false;
  }
}
