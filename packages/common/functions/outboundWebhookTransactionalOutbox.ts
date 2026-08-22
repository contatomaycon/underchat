import { and, eq, isNull, sql } from 'drizzle-orm';
import { outboundWebhookEvent } from '@core/models';
import type { Transaction } from '@core/common/types/Transaction.type';
import {
  assertOutboundWebhookPayloadSize,
  normalizeOutboundWebhookChannelIds,
  type OutboundWebhookEnvelope,
} from '@core/common/functions/outboundWebhookPayload';

export type OutboundWebhookTransactionalExecutor = Pick<
  Transaction,
  'select' | 'update'
>;

export interface MarkOutboundWebhookDomainAppliedInput {
  eventId: string;
  accountId: string;
  envelope: OutboundWebhookEnvelope;
}

/**
 * Persists the final public envelope and its domain-applied marker using the
 * caller's transaction. The journal deliberately remains `preparing`; only
 * the recovery/fan-out path may transition it to a terminal delivery state.
 *
 * Throwing when no row matches is intentional: callers must roll back the
 * domain mutation instead of committing it without its outbox marker.
 */
export async function markOutboundWebhookDomainAppliedInTransaction(
  tx: OutboundWebhookTransactionalExecutor,
  input: MarkOutboundWebhookDomainAppliedInput
): Promise<void> {
  assertOutboundWebhookPayloadSize(input.envelope);
  if (
    input.envelope.id !== input.eventId ||
    input.envelope.account_id !== input.accountId
  ) {
    throw new Error('outbound_webhook_event_envelope_identity_mismatch');
  }
  const channelIds = normalizeOutboundWebhookChannelIds(
    input.envelope.context?.channel_ids ?? []
  );
  if (
    channelIds.join('\u001f') !==
    (input.envelope.context?.channel_ids ?? []).join('\u001f')
  ) {
    throw new Error('outbound_webhook_event_channel_scope_mismatch');
  }

  const updated = await tx
    .update(outboundWebhookEvent)
    .set({
      state: 'preparing',
      payload: input.envelope,
      domain_applied_at: sql`NOW()`,
    })
    .where(
      and(
        eq(outboundWebhookEvent.outbound_webhook_event_id, input.eventId),
        eq(outboundWebhookEvent.account_id, input.accountId),
        eq(outboundWebhookEvent.state, 'preparing'),
        isNull(outboundWebhookEvent.domain_applied_at),
        eq(outboundWebhookEvent.event_type, input.envelope.type),
        eq(outboundWebhookEvent.aggregate_type, input.envelope.aggregate.type),
        eq(outboundWebhookEvent.aggregate_id, input.envelope.aggregate.id),
        eq(outboundWebhookEvent.routing_channel_ids, channelIds)
      )
    )
    .returning({
      eventId: outboundWebhookEvent.outbound_webhook_event_id,
    })
    .execute();

  if (updated.length !== 1 || updated[0]?.eventId !== input.eventId) {
    const existing = await tx
      .select({ appliedAt: outboundWebhookEvent.domain_applied_at })
      .from(outboundWebhookEvent)
      .where(
        and(
          eq(outboundWebhookEvent.outbound_webhook_event_id, input.eventId),
          eq(outboundWebhookEvent.account_id, input.accountId),
          eq(outboundWebhookEvent.event_type, input.envelope.type),
          eq(
            outboundWebhookEvent.aggregate_type,
            input.envelope.aggregate.type
          ),
          eq(outboundWebhookEvent.aggregate_id, input.envelope.aggregate.id),
          eq(outboundWebhookEvent.routing_channel_ids, channelIds)
        )
      )
      .limit(1)
      .execute();
    if (existing[0]?.appliedAt) {
      throw new Error('outbound_webhook_event_domain_already_applied');
    }
    throw new Error('outbound_webhook_event_domain_marker_not_updated');
  }
}
