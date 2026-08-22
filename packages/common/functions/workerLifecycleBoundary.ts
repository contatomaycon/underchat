interface PreparedWorkerLifecyclePublishOptions {
  publish: () => Promise<void>;
  publishAttempts?: number;
  retryDelayMs?: number;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : fallback;
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWorkerLifecycleBoundary<T>(
  operation: () => Promise<T>,
  options: {
    attempts?: number;
    retryDelayMs?: number;
  } = {}
): Promise<T> {
  const attempts = positiveInteger(options.attempts, 3);
  const retryDelayMs = positiveInteger(options.retryDelayMs, 100);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await delay(retryDelayMs);
      }
    }
  }

  throw lastError;
}

/**
 * Publishes a worker lifecycle command whose exact payload was durably
 * journaled before the database claim.
 *
 * Publishing the same lifecycle message more than once is safe because the
 * consumer fences every effect by worker_id + operation_id. A Kafka outage
 * must never compensate the confirmed database claim: doing so would orphan
 * the journal and make a later, already-accepted delivery look stale. The
 * durable journal and the fast redrive loop own recovery after these bounded
 * immediate attempts.
 */
export async function publishPreparedWorkerLifecycle(
  options: PreparedWorkerLifecyclePublishOptions
): Promise<void> {
  const retryDelayMs = positiveInteger(options.retryDelayMs, 100);
  await retryWorkerLifecycleBoundary(options.publish, {
    attempts: options.publishAttempts,
    retryDelayMs,
  });
}
