export class ProviderInvocationInFlightError extends Error {
  readonly code = 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT';
  readonly retryable = true;
  readonly reason: 'capacity' | 'stalled' | 'unavailable';

  constructor(reason: 'capacity' | 'stalled' | 'unavailable' = 'unavailable') {
    super(
      reason === 'capacity'
        ? 'outbound_provider_capacity_saturated'
        : reason === 'stalled'
          ? 'outbound_provider_scope_stalled'
          : 'outbound_provider_call_already_in_flight'
    );
    this.name = 'ProviderInvocationInFlightError';
    this.reason = reason;
  }
}

export interface IProviderInvocationLease {
  start<T>(invoke: () => Promise<T>): Promise<T>;
  markStalled(): void;
  releaseBeforeStart(): void;
}

// All services that can reach the same concrete SDK object share this fence.
// Weak identity keeps both registries bounded by the provider object's
// lifetime.
const stalledProviderScopes = new WeakSet<object>();
const activeProviderInvocations = new WeakMap<object, number>();
const MAX_HEALTHY_PROVIDER_CONCURRENCY = 4;

/**
 * Circuit and avalanche guard for an SDK runtime. Healthy runtimes retain a
 * small amount of parallelism, while a bounded admission count prevents a
 * backlog from starting dozens of uninterruptible SDK calls before the first
 * timeout trips the breaker. Once an invocation stalls, that exact
 * socket/client stays fenced even if its late promise settles. A recreated
 * provider object is a fresh scope and can send immediately.
 */
export class ProviderInvocationSingleFlight {
  acquire(scope: object): IProviderInvocationLease | null {
    const active = activeProviderInvocations.get(scope) ?? 0;
    if (
      stalledProviderScopes.has(scope) ||
      active >= MAX_HEALTHY_PROVIDER_CONCURRENCY
    ) {
      return null;
    }
    activeProviderInvocations.set(scope, active + 1);

    let started = false;
    let released = false;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      const current = activeProviderInvocations.get(scope) ?? 0;
      if (current <= 1) {
        activeProviderInvocations.delete(scope);
      } else {
        activeProviderInvocations.set(scope, current - 1);
      }
    };

    return {
      start: <T>(invoke: () => Promise<T>): Promise<T> => {
        if (started) {
          return Promise.reject(
            new Error('outbound_provider_invocation_lease_already_started')
          );
        }
        started = true;

        let operation: Promise<T>;
        try {
          operation = Promise.resolve(invoke());
        } catch (error) {
          operation = Promise.reject(error);
        }
        // Observe settlement for admission accounting without wrapping the
        // provider promise. Returning the original promise preserves the
        // timeout helper's late-settlement ordering and error observation.
        void operation.then(release, release);
        return operation;
      },
      markStalled: (): void => this.markStalled(scope),
      releaseBeforeStart: release,
    };
  }

  markStalled(scope: object): void {
    stalledProviderScopes.add(scope);
  }

  isStalled(scope: object): boolean {
    return stalledProviderScopes.has(scope);
  }

  async fenceAndWaitForIdle(scope: object, timeoutMs = 30_000): Promise<void> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('outbound_provider_drain_timeout_invalid');
    }
    // All instances share these weak registries. Fencing here prevents every
    // helper that references the same SDK object from admitting a new call.
    stalledProviderScopes.add(scope);
    const deadline = Date.now() + timeoutMs;
    while ((activeProviderInvocations.get(scope) ?? 0) > 0) {
      if (Date.now() >= deadline) {
        throw new ProviderInvocationInFlightError('stalled');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
}

export function isProviderInvocationInFlightError(
  error: unknown
): error is ProviderInvocationInFlightError {
  return (
    error instanceof ProviderInvocationInFlightError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT')
  );
}

export function isProviderInvocationCapacityError(error: unknown): boolean {
  return (
    isProviderInvocationInFlightError(error) &&
    (error as Partial<ProviderInvocationInFlightError>).reason === 'capacity'
  );
}
