export type MessageDeliveryOutcome =
  'none' | 'ambiguous' | 'sent' | 'failed' | 'delivered' | 'read';

export interface MessageDeliveryFact {
  patch?: {
    is_sent?: boolean;
    is_delivered?: boolean;
    is_seen?: boolean;
  } | null;
  failed?: boolean;
  ambiguous?: boolean;
}

const MESSAGE_DELIVERY_OUTCOME_RANK: Record<MessageDeliveryOutcome, number> = {
  none: 0,
  ambiguous: 1,
  sent: 2,
  failed: 3,
  delivered: 4,
  read: 5,
};

export function resolveMessageDeliveryOutcome(
  fact: MessageDeliveryFact
): MessageDeliveryOutcome {
  if (fact.patch?.is_seen === true) {
    return 'read';
  }
  if (fact.patch?.is_delivered === true) {
    return 'delivered';
  }
  if (fact.failed === true && fact.ambiguous !== true) {
    return 'failed';
  }
  if (fact.patch?.is_sent === true) {
    return 'sent';
  }
  if (fact.failed === true && fact.ambiguous === true) {
    return 'ambiguous';
  }
  return 'none';
}

export function messageDeliveryOutcomeRank(
  outcome: MessageDeliveryOutcome
): number {
  return MESSAGE_DELIVERY_OUTCOME_RANK[outcome];
}

export function selectStrongestMessageDeliveryOutcome(
  first: MessageDeliveryFact,
  second: MessageDeliveryFact
): MessageDeliveryOutcome {
  const firstOutcome = resolveMessageDeliveryOutcome(first);
  const secondOutcome = resolveMessageDeliveryOutcome(second);
  return messageDeliveryOutcomeRank(secondOutcome) >=
    messageDeliveryOutcomeRank(firstOutcome)
    ? secondOutcome
    : firstOutcome;
}

export function messageDeliveryFactFromOutcome(
  outcome: MessageDeliveryOutcome
): Required<Pick<MessageDeliveryFact, 'failed' | 'ambiguous'>> & {
  patch: NonNullable<MessageDeliveryFact['patch']>;
} {
  if (outcome === 'read') {
    return {
      patch: { is_sent: true, is_delivered: true, is_seen: true },
      failed: false,
      ambiguous: false,
    };
  }
  if (outcome === 'delivered') {
    return {
      patch: { is_sent: true, is_delivered: true },
      failed: false,
      ambiguous: false,
    };
  }
  if (outcome === 'sent') {
    return {
      patch: { is_sent: true },
      failed: false,
      ambiguous: false,
    };
  }

  return {
    patch: {},
    failed: outcome === 'failed' || outcome === 'ambiguous',
    ambiguous: outcome === 'ambiguous',
  };
}
