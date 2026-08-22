import type { IProviderInvocationBoundary } from '../interfaces/IProviderInvocationBoundary';

type TypingSimulationAbortReason = 'deadline' | 'parent_cancelled';
type TypingSimulationOperationOutcome =
  { kind: 'completed' } | { kind: 'failed'; error: unknown };

/**
 * Bounds uncooperative SDK typing work to one operation per helper instance.
 * A timed-out operation keeps the slot until the real provider promise
 * settles; the application deadline itself never releases the slot.
 */
export class TypingSimulationSingleFlight {
  private inFlight: Promise<void> | null = null;

  public start(operation: () => Promise<void>): Promise<void> | null {
    if (this.inFlight) {
      return null;
    }

    const running = Promise.resolve().then(operation);
    this.inFlight = running;
    const release = (): void => {
      if (this.inFlight === running) {
        this.inFlight = null;
      }
    };
    void running.then(release, release);
    return running;
  }
}

export interface ITypingSimulationControl {
  readonly signal: AbortSignal;
  checkpoint(): void;
  canCleanupPresence(): boolean;
  sleep(ms: number): Promise<void>;
}

interface ITypingSimulationExecutionOptions {
  timeoutMs: number;
  providerReserveMs?: number;
  beforeProviderInvoke?: IProviderInvocationBoundary;
  singleFlight?: TypingSimulationSingleFlight;
  simulate(control: ITypingSimulationControl): Promise<void>;
  onDeadline(input: { timeoutMs: number; durationMs: number }): void;
  onFailure(error: unknown): void;
  onSingleFlightSkipped?(): void;
}

class TypingSimulationInterruptedError extends Error {
  constructor(readonly reason: TypingSimulationAbortReason) {
    super(`typing_simulation_${reason}`);
    this.name = 'TypingSimulationInterruptedError';
  }
}

function positiveFinite(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function resolveBudgetMs(
  timeoutMs: number,
  providerReserveMs: number | undefined,
  beforeProviderInvoke: IProviderInvocationBoundary | undefined,
  now: number
): number {
  const configured = positiveFinite(timeoutMs) ?? 1;
  const parentDeadline = positiveFinite(beforeProviderInvoke?.deadlineAtMs);
  if (parentDeadline === null) {
    return configured;
  }

  const reserve = Math.max(0, positiveFinite(providerReserveMs) ?? 0);
  return Math.max(0, Math.min(configured, parentDeadline - now - reserve));
}

/**
 * Runs optional typing work behind a hard application deadline. Cooperative
 * operations stop immediately; SDK calls that cannot be aborted remain
 * observed and are fenced by checkpoints before any later presence effect.
 * Parent cancellation is never downgraded to a best-effort typing failure.
 */
export async function runTypingSimulationBestEffort(
  options: ITypingSimulationExecutionOptions
): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = resolveBudgetMs(
    options.timeoutMs,
    options.providerReserveMs,
    options.beforeProviderInvoke,
    startedAt
  );
  const controller = new AbortController();
  let parentError: unknown;
  let parentCancelled = false;
  let resolveInterrupt!: (
    outcome: { kind: 'deadline' } | { kind: 'parent_cancelled'; error: unknown }
  ) => void;
  const interrupt = new Promise<
    { kind: 'deadline' } | { kind: 'parent_cancelled'; error: unknown }
  >((resolve) => {
    resolveInterrupt = resolve;
  });

  const abort = (reason: TypingSimulationAbortReason): void => {
    if (!controller.signal.aborted) {
      controller.abort(new TypingSimulationInterruptedError(reason));
    }
  };

  const assertParentActive = (): void => {
    try {
      options.beforeProviderInvoke?.assertActive?.();
      if (options.beforeProviderInvoke?.isActive?.() === false) {
        throw new TypingSimulationInterruptedError('parent_cancelled');
      }
    } catch (error) {
      if (!parentCancelled) {
        parentCancelled = true;
        parentError = error;
        abort('parent_cancelled');
        resolveInterrupt({ kind: 'parent_cancelled', error });
      }
      throw error;
    }
  };

  const checkpoint = (): void => {
    if (parentCancelled) {
      throw parentError;
    }
    assertParentActive();
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
  };

  const sleep = async (ms: number): Promise<void> => {
    checkpoint();
    if (!Number.isFinite(ms) || ms <= 0) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const onAbort = (): void => {
        finish(() => reject(controller.signal.reason));
      };
      const finish = (complete: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        complete();
      };

      timer = setTimeout(() => finish(resolve), ms);
      timer.unref?.();
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) {
        onAbort();
      }
    });
    checkpoint();
  };

  if (timeoutMs <= 0) {
    options.onDeadline({
      timeoutMs,
      durationMs: Date.now() - startedAt,
    });
    assertParentActive();
    return;
  }

  const executeSimulation = async (): Promise<void> => {
    checkpoint();
    await options.simulate({
      signal: controller.signal,
      checkpoint,
      canCleanupPresence: () =>
        options.beforeProviderInvoke?.isRegistered?.() ?? true,
      sleep,
    });
  };
  const operation = options.singleFlight
    ? options.singleFlight.start(executeSimulation)
    : Promise.resolve().then(executeSimulation);
  if (!operation) {
    options.onSingleFlightSkipped?.();
    assertParentActive();
    return;
  }

  const deadlineTimer = setTimeout(() => {
    abort('deadline');
    resolveInterrupt({ kind: 'deadline' });
  }, timeoutMs);
  deadlineTimer.unref?.();

  const parentPollTimer =
    options.beforeProviderInvoke?.assertActive ||
    options.beforeProviderInvoke?.isActive
      ? setInterval(() => {
          try {
            assertParentActive();
          } catch {
            // The exact parent error is resolved through `interrupt`.
          }
        }, 50)
      : null;
  parentPollTimer?.unref?.();

  const observedOperation: Promise<TypingSimulationOperationOutcome> =
    operation.then(
      (): TypingSimulationOperationOutcome => ({ kind: 'completed' }),
      (error: unknown): TypingSimulationOperationOutcome => ({
        kind: 'failed',
        error,
      })
    );
  const outcome = await Promise.race([observedOperation, interrupt]);

  clearTimeout(deadlineTimer);
  if (parentPollTimer) {
    clearInterval(parentPollTimer);
  }

  if (outcome.kind === 'parent_cancelled') {
    void observedOperation.then((lateOutcome) => {
      if (
        lateOutcome.kind === 'failed' &&
        !(lateOutcome.error instanceof TypingSimulationInterruptedError) &&
        lateOutcome.error !== outcome.error
      ) {
        options.onFailure(lateOutcome.error);
      }
    });
    throw outcome.error;
  }

  const deadlineExceeded =
    outcome.kind === 'deadline' ||
    (outcome.kind === 'failed' &&
      controller.signal.reason instanceof TypingSimulationInterruptedError &&
      controller.signal.reason.reason === 'deadline');
  if (deadlineExceeded) {
    void observedOperation.then((lateOutcome) => {
      if (
        lateOutcome.kind === 'failed' &&
        !(lateOutcome.error instanceof TypingSimulationInterruptedError)
      ) {
        options.onFailure(lateOutcome.error);
      }
    });
    options.onDeadline({
      timeoutMs,
      durationMs: Date.now() - startedAt,
    });
    assertParentActive();
    return;
  }

  if (parentCancelled) {
    throw parentError;
  }
  if (outcome.kind === 'failed') {
    options.onFailure(outcome.error);
  }

  assertParentActive();
}
