const AUTHORITATIVE_LIFECYCLE_CONFLICT =
  /^[a-z0-9]+(?:_[a-z0-9]+)*_(?:fence_changed|container_conflict)$/u;
const GRPC_ERROR_PREFIX = /^\d+\s+[a-z_]+:\s*/u;

function lifecycleErrorTexts(error: unknown): string[] {
  if (!error || typeof error !== 'object') {
    return [];
  }

  const candidate = error as { message?: unknown; details?: unknown };
  return [candidate.message, candidate.details].filter(
    (value): value is string => typeof value === 'string'
  );
}

/**
 * These conflicts are authoritative compare-and-swap outcomes, not transient
 * infrastructure failures. Retrying the same delivery inline cannot change
 * them; the durable lifecycle journal must be reconciled and redriven.
 */
export function isWorkerLifecycleAuthoritativeConflictError(
  error: unknown
): boolean {
  return lifecycleErrorTexts(error).some((text) => {
    const normalized = text.trim().toLowerCase().replace(GRPC_ERROR_PREFIX, '');
    const [errorCode] = normalized.split(':', 1);
    return AUTHORITATIVE_LIFECYCLE_CONFLICT.test(errorCode);
  });
}
