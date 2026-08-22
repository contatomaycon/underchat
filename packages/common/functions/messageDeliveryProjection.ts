import {
  messageDeliveryFactFromOutcome,
  messageDeliveryOutcomeRank,
  resolveMessageDeliveryOutcome,
} from './messageDeliveryOutcome';

export interface MessageDeliverySummaryProjection {
  is_sent: boolean;
  is_delivered: boolean;
  is_seen: boolean;
  is_sent_to_internal: boolean;
}

export type MessageDeliveryProjectionInput = {
  summary?: MessageDeliverySummaryProjection | null;
  delivery_status?: string | null;
  provider_error_code?: number | null;
  provider_status_at?: string | null;
};

export type MessageDeliveryProjection = {
  summary: MessageDeliverySummaryProjection | null;
  delivery_status: string | null;
  provider_error_code: number | null;
  provider_status_at: string | null;
};

const outcomeFor = (message?: Partial<MessageDeliveryProjectionInput> | null) =>
  resolveMessageDeliveryOutcome({
    patch: message?.summary,
    failed:
      message?.delivery_status === 'failed' ||
      message?.delivery_status === 'ambiguous' ||
      message?.summary?.is_sent_to_internal === false,
    ambiguous: message?.delivery_status === 'ambiguous',
  });

export const mergeMessageDeliveryProjection = (
  incoming: Partial<MessageDeliveryProjectionInput>,
  existing?: Partial<MessageDeliveryProjectionInput> | null
): MessageDeliveryProjection => {
  const incomingOutcome = outcomeFor(incoming);
  const existingOutcome = outcomeFor(existing);
  const incomingRank = messageDeliveryOutcomeRank(incomingOutcome);
  const existingRank = messageDeliveryOutcomeRank(existingOutcome);
  const incomingWins = incomingRank >= existingRank;
  const outcome = incomingWins ? incomingOutcome : existingOutcome;
  const metadataSource = incomingWins ? incoming : existing;
  const fact = messageDeliveryFactFromOutcome(outcome);

  if (outcome === 'none') {
    return {
      summary: incoming.summary ?? existing?.summary ?? null,
      delivery_status:
        incoming.delivery_status ?? existing?.delivery_status ?? null,
      provider_error_code:
        incoming.provider_error_code ?? existing?.provider_error_code ?? null,
      provider_status_at:
        incoming.provider_status_at ?? existing?.provider_status_at ?? null,
    };
  }

  const positive =
    outcome === 'sent' || outcome === 'delivered' || outcome === 'read';

  return {
    summary: {
      is_sent: fact.patch.is_sent === true,
      is_delivered: fact.patch.is_delivered === true,
      is_seen: fact.patch.is_seen === true,
      is_sent_to_internal: positive,
    },
    delivery_status: outcome,
    provider_error_code:
      outcome === 'failed'
        ? (metadataSource?.provider_error_code ?? null)
        : null,
    provider_status_at: metadataSource?.provider_status_at ?? null,
  };
};
