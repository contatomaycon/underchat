const DEFAULT_CRITICAL_REDIS_TIMEOUT_MS = 3_000;
const MIN_CRITICAL_REDIS_TIMEOUT_MS = 250;
const MAX_CRITICAL_REDIS_TIMEOUT_MS = 30_000;

export class CriticalRedisOperationError extends Error {
  public readonly operation: string;
  public readonly timeout: boolean;
  public readonly cause: unknown;

  constructor(operation: string, cause: unknown, timeout = false) {
    const detail =
      cause instanceof Error ? cause.message : String(cause ?? 'unknown error');
    super(`Critical Redis operation ${operation} failed: ${detail}`);
    this.name = 'CriticalRedisOperationError';
    this.operation = operation;
    this.timeout = timeout;
    this.cause = cause;
  }
}

export function isCriticalRedisOperationError(
  error: unknown
): error is CriticalRedisOperationError {
  return error instanceof CriticalRedisOperationError;
}

export function criticalRedisOperationTimeoutMs(): number {
  const configured = Number(process.env.CRITICAL_REDIS_OPERATION_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_CRITICAL_REDIS_TIMEOUT_MS;
  }
  return Math.min(
    MAX_CRITICAL_REDIS_TIMEOUT_MS,
    Math.max(MIN_CRITICAL_REDIS_TIMEOUT_MS, Math.floor(configured))
  );
}

export async function runCriticalRedisOperation<T>(
  operation: string,
  action: () => Promise<T>,
  timeoutMs = criticalRedisOperationTimeoutMs()
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const boundedTimeoutMs = Math.min(
    MAX_CRITICAL_REDIS_TIMEOUT_MS,
    Math.max(MIN_CRITICAL_REDIS_TIMEOUT_MS, Math.floor(timeoutMs))
  );
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new CriticalRedisOperationError(
          operation,
          new Error(`deadline exceeded after ${boundedTimeoutMs}ms`),
          true
        )
      );
    }, boundedTimeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([
      Promise.resolve()
        .then(action)
        .catch((error: unknown) => {
          if (isCriticalRedisOperationError(error)) {
            throw error;
          }
          throw new CriticalRedisOperationError(operation, error);
        }),
      timeout,
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
