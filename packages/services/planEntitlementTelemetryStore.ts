export const PLAN_ENTITLEMENT_DECISION_SURFACES = [
  'manager_api',
  'public_api',
  'inbound_webhook_auth',
  'inbound_webhook_processing',
  'inbound_worker',
  'contact_consumer',
  'message_consumer',
  'outbound_capture',
  'outbound_dispatcher',
  'outbound_recovery',
] as const;

export const PLAN_ENTITLEMENT_DECISION_OUTCOMES = [
  'allowed',
  'denied',
  'unavailable',
] as const;

export const PLAN_ENTITLEMENT_CACHE_OUTCOMES = [
  'hit',
  'miss',
  'redis_fallback',
  'database_failure',
] as const;

export const PLAN_ENTITLEMENT_FENCE_OPERATIONS = [
  'install',
  'release',
] as const;

export const PLAN_ENTITLEMENT_FENCE_OUTCOMES = ['success', 'error'] as const;

export const PLAN_ENTITLEMENT_SUPPRESSION_SURFACES = [
  'inbound_worker',
  'contact_consumer',
  'message_consumer',
  'outbound_capture',
  'outbound_dispatcher',
  'outbound_recovery',
] as const;

export const PLAN_ENTITLEMENT_SUPPRESSION_REASONS = [
  'integration_entitlement_missing',
  'legacy_revision_missing',
  'revision_mismatch',
  'other',
] as const;

export type PlanEntitlementDecisionSurface =
  (typeof PLAN_ENTITLEMENT_DECISION_SURFACES)[number];
export type PlanEntitlementDecisionOutcome =
  (typeof PLAN_ENTITLEMENT_DECISION_OUTCOMES)[number];
export type PlanEntitlementCacheOutcome =
  (typeof PLAN_ENTITLEMENT_CACHE_OUTCOMES)[number];
export type PlanEntitlementFenceOperation =
  (typeof PLAN_ENTITLEMENT_FENCE_OPERATIONS)[number];
export type PlanEntitlementFenceOutcome =
  (typeof PLAN_ENTITLEMENT_FENCE_OUTCOMES)[number];
export type PlanEntitlementSuppressionSurface =
  (typeof PLAN_ENTITLEMENT_SUPPRESSION_SURFACES)[number];
export type PlanEntitlementSuppressionReason =
  (typeof PLAN_ENTITLEMENT_SUPPRESSION_REASONS)[number];

type DecisionCounters = Record<PlanEntitlementDecisionOutcome, number>;
type FenceCounters = Record<PlanEntitlementFenceOutcome, number>;
type SuppressionCounters = Record<PlanEntitlementSuppressionReason, number>;

interface PlanEntitlementTelemetryCounters {
  readonly decisions: Record<PlanEntitlementDecisionSurface, DecisionCounters>;
  readonly cache: Record<PlanEntitlementCacheOutcome, number>;
  readonly fences: Record<PlanEntitlementFenceOperation, FenceCounters>;
  readonly suppressions: Record<
    PlanEntitlementSuppressionSurface,
    SuppressionCounters
  >;
}

export interface PlanEntitlementTelemetrySnapshot {
  readonly decisions: Readonly<
    Record<
      PlanEntitlementDecisionSurface,
      Readonly<Record<PlanEntitlementDecisionOutcome, number>>
    >
  >;
  readonly cache: Readonly<Record<PlanEntitlementCacheOutcome, number>>;
  readonly fences: Readonly<
    Record<
      PlanEntitlementFenceOperation,
      Readonly<Record<PlanEntitlementFenceOutcome, number>>
    >
  >;
  readonly suppressions: Readonly<
    Record<
      PlanEntitlementSuppressionSurface,
      Readonly<Record<PlanEntitlementSuppressionReason, number>>
    >
  >;
}

export interface PlanEntitlementTelemetryStore {
  recordDecision(
    surface: PlanEntitlementDecisionSurface,
    outcome: PlanEntitlementDecisionOutcome
  ): void;
  recordCache(outcome: PlanEntitlementCacheOutcome): void;
  recordFence(
    operation: PlanEntitlementFenceOperation,
    outcome: PlanEntitlementFenceOutcome
  ): void;
  recordSuppression(
    surface: PlanEntitlementSuppressionSurface,
    reason: PlanEntitlementSuppressionReason
  ): void;
  snapshot(): PlanEntitlementTelemetrySnapshot;
  flush(): PlanEntitlementTelemetrySnapshot | null;
}

export interface PlanEntitlementAuditContextInput {
  readonly surface: PlanEntitlementDecisionSurface;
  readonly outcome: PlanEntitlementDecisionOutcome;
  readonly accountId: string;
  readonly planProductId: string;
  readonly revision?: string | null;
  readonly source?: 'plan' | 'addon' | null;
  readonly requestId?: string | null;
  readonly eventId?: string | null;
  readonly reason?: string | null;
}

export interface PlanEntitlementAuditContext {
  readonly type: 'plan_entitlement_audit';
  readonly surface: PlanEntitlementDecisionSurface;
  readonly outcome: PlanEntitlementDecisionOutcome;
  readonly account_id: string;
  readonly plan_product_id: string;
  readonly revision?: string;
  readonly source: 'plan' | 'addon' | null;
  readonly request_id?: string;
  readonly event_id?: string;
  readonly reason?: string;
}

const createRecord = <TKey extends string, TValue>(
  keys: readonly TKey[],
  createValue: () => TValue
): Record<TKey, TValue> =>
  Object.fromEntries(keys.map((key) => [key, createValue()])) as Record<
    TKey,
    TValue
  >;

const createDecisionCounters = (): DecisionCounters =>
  createRecord(PLAN_ENTITLEMENT_DECISION_OUTCOMES, () => 0);

const createFenceCounters = (): FenceCounters =>
  createRecord(PLAN_ENTITLEMENT_FENCE_OUTCOMES, () => 0);

const createSuppressionCounters = (): SuppressionCounters =>
  createRecord(PLAN_ENTITLEMENT_SUPPRESSION_REASONS, () => 0);

const createCounters = (): PlanEntitlementTelemetryCounters => ({
  decisions: createRecord(
    PLAN_ENTITLEMENT_DECISION_SURFACES,
    createDecisionCounters
  ),
  cache: createRecord(PLAN_ENTITLEMENT_CACHE_OUTCOMES, () => 0),
  fences: createRecord(PLAN_ENTITLEMENT_FENCE_OPERATIONS, createFenceCounters),
  suppressions: createRecord(
    PLAN_ENTITLEMENT_SUPPRESSION_SURFACES,
    createSuppressionCounters
  ),
});

const copyCounters = (
  counters: PlanEntitlementTelemetryCounters
): PlanEntitlementTelemetrySnapshot => ({
  decisions: createRecord(PLAN_ENTITLEMENT_DECISION_SURFACES, () => ({
    allowed: 0,
    denied: 0,
    unavailable: 0,
  })),
  cache: { ...counters.cache },
  fences: createRecord(PLAN_ENTITLEMENT_FENCE_OPERATIONS, () => ({
    success: 0,
    error: 0,
  })),
  suppressions: createRecord(PLAN_ENTITLEMENT_SUPPRESSION_SURFACES, () => ({
    integration_entitlement_missing: 0,
    legacy_revision_missing: 0,
    revision_mismatch: 0,
    other: 0,
  })),
});

const snapshotCounters = (
  counters: PlanEntitlementTelemetryCounters
): PlanEntitlementTelemetrySnapshot => {
  const snapshot = copyCounters(counters);
  for (const surface of PLAN_ENTITLEMENT_DECISION_SURFACES) {
    Object.assign(snapshot.decisions[surface], counters.decisions[surface]);
  }
  for (const operation of PLAN_ENTITLEMENT_FENCE_OPERATIONS) {
    Object.assign(snapshot.fences[operation], counters.fences[operation]);
  }
  for (const surface of PLAN_ENTITLEMENT_SUPPRESSION_SURFACES) {
    Object.assign(
      snapshot.suppressions[surface],
      counters.suppressions[surface]
    );
  }
  return snapshot;
};

const totalActivity = (counters: PlanEntitlementTelemetryCounters): number => {
  let total = 0;
  for (const surface of PLAN_ENTITLEMENT_DECISION_SURFACES) {
    for (const outcome of PLAN_ENTITLEMENT_DECISION_OUTCOMES) {
      total += counters.decisions[surface][outcome];
    }
  }
  for (const outcome of PLAN_ENTITLEMENT_CACHE_OUTCOMES) {
    total += counters.cache[outcome];
  }
  for (const operation of PLAN_ENTITLEMENT_FENCE_OPERATIONS) {
    for (const outcome of PLAN_ENTITLEMENT_FENCE_OUTCOMES) {
      total += counters.fences[operation][outcome];
    }
  }
  for (const surface of PLAN_ENTITLEMENT_SUPPRESSION_SURFACES) {
    for (const reason of PLAN_ENTITLEMENT_SUPPRESSION_REASONS) {
      total += counters.suppressions[surface][reason];
    }
  }
  return total;
};

/**
 * In-process low-cardinality counters. Account, request and event identifiers
 * deliberately belong only in structured audit logs, never metric labels.
 */
export const createPlanEntitlementTelemetryStore =
  (): PlanEntitlementTelemetryStore => {
    let counters = createCounters();

    return {
      recordDecision: (surface, outcome): void => {
        counters.decisions[surface][outcome] += 1;
      },
      recordCache: (outcome): void => {
        counters.cache[outcome] += 1;
      },
      recordFence: (operation, outcome): void => {
        counters.fences[operation][outcome] += 1;
      },
      recordSuppression: (surface, reason): void => {
        counters.suppressions[surface][reason] += 1;
      },
      snapshot: (): PlanEntitlementTelemetrySnapshot =>
        snapshotCounters(counters),
      flush: (): PlanEntitlementTelemetrySnapshot | null => {
        if (totalActivity(counters) === 0) return null;
        const snapshot = snapshotCounters(counters);
        counters = createCounters();
        return snapshot;
      },
    };
  };

export const planEntitlementTelemetryStore =
  createPlanEntitlementTelemetryStore();

export const createPlanEntitlementAuditContext = (
  input: PlanEntitlementAuditContextInput
): PlanEntitlementAuditContext => ({
  type: 'plan_entitlement_audit',
  surface: input.surface,
  outcome: input.outcome,
  account_id: input.accountId,
  plan_product_id: input.planProductId,
  ...(input.revision ? { revision: input.revision } : {}),
  source: input.source ?? null,
  ...(input.requestId ? { request_id: input.requestId } : {}),
  ...(input.eventId ? { event_id: input.eventId } : {}),
  ...(input.reason ? { reason: input.reason } : {}),
});

/** Reads the authoritative grant origin carried by entitlement results/errors. */
export const getPlanEntitlementAuditSource = (
  value: unknown
): 'plan' | 'addon' | null => {
  if (!value || typeof value !== 'object' || !('source' in value)) {
    return null;
  }
  const source = (value as { source?: unknown }).source;
  return source === 'plan' || source === 'addon' ? source : null;
};
