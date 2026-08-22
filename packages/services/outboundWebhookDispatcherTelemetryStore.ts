import type {
  CompleteOutboundWebhookAttemptInput,
  CompleteOutboundWebhookAttemptResult,
  OutboundWebhookAttemptOutcome,
  OutboundWebhookDispatcherStore,
  OutboundWebhookPreparation,
} from '@core/services/outboundWebhookDispatcherStore';
import { planEntitlementTelemetryStore } from '@core/services/planEntitlementTelemetryStore';

const ATTEMPT_OUTCOMES: readonly OutboundWebhookAttemptOutcome[] = [
  'succeeded',
  'http_error',
  'network_error',
  'timeout',
  'internal_error',
  'suppressed',
];

interface DispatcherCounters {
  claimCycles: number;
  claimFailures: number;
  claimed: number;
  prepared: number;
  suppressed: number;
  lostBeforeAttempt: number;
  completionsApplied: number;
  completionsLost: number;
  requestDurationMs: number;
  readonly deliveryStatuses: Record<'succeeded' | 'retrying' | 'dead', number>;
  readonly attemptOutcomes: Record<OutboundWebhookAttemptOutcome, number>;
  readonly suppressionReasons: Record<string, number>;
}

export interface WebhookDispatcherTelemetrySnapshot {
  readonly claim_cycles: number;
  readonly claim_failures: number;
  readonly claimed: number;
  readonly prepared: number;
  readonly suppressed: number;
  readonly lost_before_attempt: number;
  readonly completions_applied: number;
  readonly completions_lost: number;
  readonly average_request_duration_ms: number;
  readonly delivery_statuses: Readonly<Record<string, number>>;
  readonly attempt_outcomes: Readonly<Record<string, number>>;
  readonly suppression_reasons: Readonly<Record<string, number>>;
}

export interface TelemetryOutboundWebhookDispatcherStore {
  readonly store: OutboundWebhookDispatcherStore;
  getClaimHealth(): WebhookDispatcherClaimHealth;
  flush(): WebhookDispatcherTelemetrySnapshot | null;
}

export interface WebhookDispatcherClaimHealth {
  readonly isHealthy: boolean;
  readonly consecutiveFailures: number;
  readonly failureThreshold: number;
}

export type WebhookDispatcherRuntimeState = 'starting' | 'running' | 'stopping';

interface IsWebhookDispatcherDeliveryReadyInput {
  readonly runtimeState: WebhookDispatcherRuntimeState;
  readonly workerFailure: string | null;
  readonly isLoopRunning: boolean;
  readonly claimHealth: WebhookDispatcherClaimHealth | null;
}

interface TelemetryStoreOptions {
  readonly claimFailureThreshold?: number;
}

const createCounters = (): DispatcherCounters => ({
  claimCycles: 0,
  claimFailures: 0,
  claimed: 0,
  prepared: 0,
  suppressed: 0,
  lostBeforeAttempt: 0,
  completionsApplied: 0,
  completionsLost: 0,
  requestDurationMs: 0,
  deliveryStatuses: { succeeded: 0, retrying: 0, dead: 0 },
  attemptOutcomes: Object.fromEntries(
    ATTEMPT_OUTCOMES.map((outcome) => [outcome, 0])
  ) as Record<OutboundWebhookAttemptOutcome, number>,
  suppressionReasons: {},
});

/** Adds low-cardinality operational counters without changing delivery logic. */
export const createTelemetryOutboundWebhookDispatcherStore = (
  delegate: OutboundWebhookDispatcherStore,
  options: TelemetryStoreOptions = {}
): TelemetryOutboundWebhookDispatcherStore => {
  const claimFailureThreshold = Math.max(
    1,
    Math.floor(options.claimFailureThreshold ?? 5)
  );
  let counters = createCounters();
  let consecutiveClaimFailures = 0;

  const store: OutboundWebhookDispatcherStore = {
    claimDue: async (input) => {
      try {
        const claims = await delegate.claimDue(input);
        counters.claimCycles += 1;
        counters.claimed += claims.length;
        consecutiveClaimFailures = 0;
        return claims;
      } catch (error: unknown) {
        counters.claimFailures += 1;
        consecutiveClaimFailures += 1;
        throw error;
      }
    },
    prepareAttempt: async (input): Promise<OutboundWebhookPreparation> => {
      try {
        const preparation = await delegate.prepareAttempt(input);
        if (preparation.kind === 'ready') {
          counters.prepared += 1;
          planEntitlementTelemetryStore.recordDecision(
            'outbound_dispatcher',
            'allowed'
          );
        } else if (preparation.kind === 'suppressed') {
          counters.suppressed += 1;
          counters.attemptOutcomes.suppressed += 1;
          counters.suppressionReasons[preparation.reason] =
            (counters.suppressionReasons[preparation.reason] ?? 0) + 1;
          if (preparation.reason === 'integration_entitlement_missing') {
            planEntitlementTelemetryStore.recordDecision(
              'outbound_dispatcher',
              'denied'
            );
            planEntitlementTelemetryStore.recordSuppression(
              'outbound_dispatcher',
              'integration_entitlement_missing'
            );
          }
        } else {
          counters.lostBeforeAttempt += 1;
        }
        return preparation;
      } catch (error) {
        planEntitlementTelemetryStore.recordDecision(
          'outbound_dispatcher',
          'unavailable'
        );
        throw error;
      }
    },
    completeAttempt: async (
      input: CompleteOutboundWebhookAttemptInput
    ): Promise<CompleteOutboundWebhookAttemptResult> => {
      const result = await delegate.completeAttempt(input);
      if (result.applied) {
        counters.completionsApplied += 1;
        counters.deliveryStatuses[input.deliveryStatus] += 1;
        counters.attemptOutcomes[input.attemptOutcome] += 1;
        counters.requestDurationMs += input.durationMs;
      } else {
        counters.completionsLost += 1;
      }
      return result;
    },
  };

  return {
    store,
    getClaimHealth: (): WebhookDispatcherClaimHealth => ({
      isHealthy: consecutiveClaimFailures < claimFailureThreshold,
      consecutiveFailures: consecutiveClaimFailures,
      failureThreshold: claimFailureThreshold,
    }),
    flush: (): WebhookDispatcherTelemetrySnapshot | null => {
      const totalActivity =
        counters.claimCycles +
        counters.claimFailures +
        counters.completionsApplied;
      if (totalActivity === 0) return null;

      const snapshot: WebhookDispatcherTelemetrySnapshot = {
        claim_cycles: counters.claimCycles,
        claim_failures: counters.claimFailures,
        claimed: counters.claimed,
        prepared: counters.prepared,
        suppressed: counters.suppressed,
        lost_before_attempt: counters.lostBeforeAttempt,
        completions_applied: counters.completionsApplied,
        completions_lost: counters.completionsLost,
        average_request_duration_ms:
          counters.completionsApplied > 0
            ? Math.round(
                counters.requestDurationMs / counters.completionsApplied
              )
            : 0,
        delivery_statuses: { ...counters.deliveryStatuses },
        attempt_outcomes: { ...counters.attemptOutcomes },
        suppression_reasons: { ...counters.suppressionReasons },
      };
      counters = createCounters();
      return snapshot;
    },
  };
};

/** Readiness policy for the delivery loop; transient claim failures recover. */
export const isWebhookDispatcherDeliveryReady = (
  input: IsWebhookDispatcherDeliveryReadyInput
): boolean =>
  input.runtimeState === 'running' &&
  !input.workerFailure &&
  input.isLoopRunning &&
  input.claimHealth?.isHealthy === true;
