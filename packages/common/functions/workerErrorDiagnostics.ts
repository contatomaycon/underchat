export interface WorkerErrorDiagnostics {
  error_name: string;
  error_code: string;
}

const UNKNOWN_ERROR_NAME = 'unknown_error';
const UNKNOWN_ERROR_CODE = 'unclassified_error';
const MAX_ERROR_TOKEN_LENGTH = 64;
const SAFE_ERROR_TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/;
const SAFE_ERROR_NAME_PATTERN =
  /^(?:error|[a-zA-Z][a-zA-Z0-9]*(?:Error|Exception|Failure|Timeout))$/;
const SAFE_ERROR_CODE_PATTERN =
  /^(?:[0-9A-Z]{5}|E[A-Z0-9_]{2,63}|ERR_[A-Z0-9_]{2,59}|WORKER_[A-Z0-9_]{2,56}|WHATSAPP_[A-Z0-9_]{2,54}|GRPC_[A-Z0-9_]{2,58}|PG_[A-Z0-9_]{2,60}|DB_[A-Z0-9_]{2,60})$/i;
const SAFE_PROVIDER_SESSION_ERROR_CODES = new Set([
  'CODEC_INCOMPATIBLE',
  'FENCING_TOKEN_STALE',
  'LEASE_LOST',
  'PROJECTION_INVALID',
  'REVISION_INVALID',
  'SESSION_ISOLATION_VIOLATION',
]);
const RETRYABLE_RUNTIME_TRANSITION_ERROR = 'worker_runtime_fence_rejected';
const MAX_ERROR_CAUSE_DEPTH = 4;

function ownDataProperty(value: object, property: string): unknown | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function normalizeToken(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? `code_${value}` : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const candidate = value.trim();
  if (
    !candidate ||
    candidate.length > MAX_ERROR_TOKEN_LENGTH ||
    !SAFE_ERROR_TOKEN_PATTERN.test(candidate)
  ) {
    return undefined;
  }

  const token = candidate
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[.:-]+/g, '_')
    .toLowerCase();

  return token || undefined;
}

function normalizeErrorName(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_ERROR_NAME_PATTERN.test(value.trim())
    ? normalizeToken(value)
    : undefined;
}

function normalizeErrorCode(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return normalizeToken(value);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const candidate = value.trim();
  return SAFE_ERROR_CODE_PATTERN.test(candidate) ||
    SAFE_PROVIDER_SESSION_ERROR_CODES.has(candidate.toUpperCase())
    ? candidate.replace(/[.:-]+/g, '_').toLowerCase()
    : undefined;
}

function isErrorInstance(value: unknown): boolean {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function errorObject(value: unknown): object | undefined {
  return (typeof value === 'object' && value !== null) ||
    typeof value === 'function'
    ? (value as object)
    : undefined;
}

/**
 * Identifies the narrow runtime-fence race that can happen while a provider
 * finishes removing the previous session and the manager has already issued
 * the next pairing grant. The message is inspected only for an application-
 * owned token and is never returned or logged.
 *
 * The caller must still prove that the QR attempt is current and enforce its
 * setup deadline. A genuinely stale/superseded attempt therefore cannot use
 * this classification to regain ownership.
 */
export function isRetryableWorkerRuntimeTransitionError(
  error: unknown
): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    const object = errorObject(current);
    if (!object) return false;

    const message = ownDataProperty(object, 'message');
    const details = ownDataProperty(object, 'details');
    if (
      (typeof message === 'string' &&
        message.includes(RETRYABLE_RUNTIME_TRANSITION_ERROR)) ||
      (typeof details === 'string' &&
        details.includes(RETRYABLE_RUNTIME_TRANSITION_ERROR))
    ) {
      return true;
    }

    current = ownDataProperty(object, 'cause');
  }

  return false;
}

/**
 * Returns the only error fields that workers may emit to logs or durable
 * diagnostics. Error messages, stacks, causes and enumerable metadata are
 * deliberately never read or stringified because they may contain a DSN,
 * runtime capability, QR payload or persisted session material.
 */
export function workerErrorDiagnostics(error: unknown): WorkerErrorDiagnostics {
  const object = errorObject(error);
  if (!object) {
    return {
      error_name: UNKNOWN_ERROR_NAME,
      error_code: UNKNOWN_ERROR_CODE,
    };
  }

  const ownName = normalizeErrorName(ownDataProperty(object, 'name'));
  const errorName = ownName ?? (isErrorInstance(error) ? 'error' : undefined);
  let errorCode: string | undefined;
  let current: unknown = error;
  const visited = new Set<object>();
  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    const currentObject = errorObject(current);
    if (!currentObject || visited.has(currentObject)) break;
    visited.add(currentObject);

    errorCode =
      normalizeErrorCode(ownDataProperty(currentObject, 'code')) ??
      normalizeErrorCode(ownDataProperty(currentObject, 'Code'));
    if (errorCode) break;

    // Application wrappers retain the causal error in one of these two own
    // data properties. Never inspect messages, stacks or enumerable metadata:
    // they can contain a DSN, QR payload, writer capability or session data.
    current =
      ownDataProperty(currentObject, 'cause') ??
      ownDataProperty(currentObject, 'originalError');
  }

  return {
    error_name: errorName ?? UNKNOWN_ERROR_NAME,
    error_code: errorCode ?? UNKNOWN_ERROR_CODE,
  };
}

/**
 * Builds a stable failure reason without incorporating the thrown value.
 * `scope` must be an application-owned token; unsafe/dynamic scopes collapse
 * to a fixed fallback instead of being rewritten and potentially leaking data.
 */
export function workerErrorFailureReason(
  scope: string,
  error: unknown
): string {
  const safeScope = normalizeToken(scope) ?? 'worker_operation_failed';
  const { error_code: errorCode } = workerErrorDiagnostics(error);

  return errorCode === UNKNOWN_ERROR_CODE
    ? safeScope
    : `${safeScope}:${errorCode}`;
}
