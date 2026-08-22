export type AuxiliaryProviderName = 'baileys' | 'wwebjs';

const DEFAULT_PROVIDER_AUXILIARY_TIMEOUT_MS = 15_000;
const MIN_PROVIDER_AUXILIARY_TIMEOUT_MS = 1_000;
const MAX_PROVIDER_AUXILIARY_TIMEOUT_MS = 60_000;

export function resolveProviderAuxiliaryTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS ?? '',
    10
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PROVIDER_AUXILIARY_TIMEOUT_MS;
  }

  return Math.min(
    MAX_PROVIDER_AUXILIARY_TIMEOUT_MS,
    Math.max(MIN_PROVIDER_AUXILIARY_TIMEOUT_MS, parsed)
  );
}

export class ProviderAuxiliaryInvocationTimeoutError extends Error {
  readonly code = 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT';
  readonly retryable = true;

  constructor(
    readonly provider: AuxiliaryProviderName,
    readonly operation: string,
    readonly timeoutMs: number
  ) {
    super(
      `${provider} auxiliary provider operation ${operation} timed out after ${timeoutMs}ms`
    );
    this.name = 'ProviderAuxiliaryInvocationTimeoutError';
  }
}

export class ProviderAuxiliaryInvocationInFlightError extends Error {
  readonly code = 'WHATSAPP_PROVIDER_AUXILIARY_IN_FLIGHT';
  readonly retryable = true;

  constructor(readonly operationKey: string) {
    super(`auxiliary provider operation already in flight: ${operationKey}`);
    this.name = 'ProviderAuxiliaryInvocationInFlightError';
  }
}

export function isProviderAuxiliaryInvocationFenceError(
  error: unknown
): boolean {
  if (
    error instanceof ProviderAuxiliaryInvocationTimeoutError ||
    error instanceof ProviderAuxiliaryInvocationInFlightError
  ) {
    return true;
  }

  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return (
    code === 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT' ||
    code === 'WHATSAPP_PROVIDER_AUXILIARY_IN_FLIGHT' ||
    code === 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT'
  );
}

export interface IProviderAuxiliaryInvocationLease {
  start<T>(invoke: () => Promise<T>): Promise<T>;
  releaseBeforeStart(): void;
}

/**
 * Reserves one stable auxiliary operation key per concrete SDK object. The
 * slot follows the real provider promise, not the application timeout. This
 * prevents retries/rebalances from accumulating calls behind an SDK promise
 * that ignored its deadline and might still complete later.
 */
export class ProviderAuxiliaryInvocationSingleFlight {
  private readonly scopes = new WeakMap<object, Map<string, symbol>>();

  acquire(
    scope: object,
    operationKey: string
  ): IProviderAuxiliaryInvocationLease | null {
    const normalizedKey = operationKey.trim();
    if (!normalizedKey) {
      throw new Error('provider auxiliary operation key is required');
    }

    const operations = this.scopes.get(scope) ?? new Map<string, symbol>();
    if (operations.has(normalizedKey)) {
      return null;
    }

    const token = Symbol(normalizedKey);
    operations.set(normalizedKey, token);
    this.scopes.set(scope, operations);
    let started = false;
    let released = false;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      if (operations.get(normalizedKey) === token) {
        operations.delete(normalizedKey);
      }
      if (operations.size === 0) {
        this.scopes.delete(scope);
      }
    };

    return {
      start: <T>(invoke: () => Promise<T>): Promise<T> => {
        if (started) {
          return Promise.reject(
            new Error('provider auxiliary invocation lease already started')
          );
        }
        started = true;

        let operation: Promise<T>;
        try {
          operation = Promise.resolve(invoke());
        } catch (error) {
          operation = Promise.reject(error);
        }
        void operation.then(release, release);
        return operation;
      },
      releaseBeforeStart: (): void => {
        if (!started) {
          release();
        }
      },
    };
  }
}

interface IProviderAuxiliaryInvocationInput<T> {
  provider: AuxiliaryProviderName;
  operation: string;
  timeoutMs?: number;
  invoke: () => Promise<T>;
}

function describeError(error: unknown): {
  name?: string;
  message: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return { message: String(error ?? '') };
}

/**
 * Places an application deadline around SDK calls that do not expose a
 * cancellation signal. The real promise remains observed after the deadline,
 * so a late rejection cannot crash the worker with an unhandled rejection.
 *
 * Callers own the provider-scope fence: a timeout must keep that exact SDK
 * object fenced until connection recovery replaces it.
 */
export function invokeProviderAuxiliaryWithTimeout<T>(
  input: IProviderAuxiliaryInvocationInput<T>
): Promise<T> {
  const timeoutMs =
    typeof input.timeoutMs === 'number' &&
    Number.isFinite(input.timeoutMs) &&
    input.timeoutMs > 0
      ? Math.floor(input.timeoutMs)
      : resolveProviderAuxiliaryTimeoutMs();
  const startedAt = Date.now();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      const error = new ProviderAuxiliaryInvocationTimeoutError(
        input.provider,
        input.operation,
        timeoutMs
      );
      console.error('[WhatsappProviderAuxiliary] operation_timeout', {
        provider: input.provider,
        operation: input.operation,
        timeout_ms: timeoutMs,
        duration_ms: Date.now() - startedAt,
      });
      reject(error);
    }, timeoutMs);
    timer.unref?.();

    let providerCall: Promise<T>;
    try {
      providerCall = Promise.resolve(input.invoke());
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      reject(error);
      return;
    }

    void providerCall.then(
      (value) => {
        if (settled) {
          console.warn(
            '[WhatsappProviderAuxiliary] operation_resolved_after_timeout',
            {
              provider: input.provider,
              operation: input.operation,
              timeout_ms: timeoutMs,
              duration_ms: Date.now() - startedAt,
            }
          );
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {
          console.warn(
            '[WhatsappProviderAuxiliary] operation_rejected_after_timeout',
            {
              provider: input.provider,
              operation: input.operation,
              timeout_ms: timeoutMs,
              duration_ms: Date.now() - startedAt,
              error: describeError(error),
            }
          );
          return;
        }

        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
