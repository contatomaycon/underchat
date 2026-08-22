/*
 * Docker evaluates the process/event-loop liveness probe independently from
 * WhatsApp, Kafka and Balance readiness. The schedule detector is deliberately
 * faster than the Docker probe interval so a frozen, already-started runtime
 * reaches the durable recreate lifecycle inside a two-minute operational
 * bound under a reachable worker host.
 */
export const WORKER_CONTAINER_HEALTH_INTERVAL_MS = 15_000;
export const WORKER_CONTAINER_HEALTH_START_INTERVAL_MS = 15_000;
export const WORKER_CONTAINER_HEALTH_TIMEOUT_MS = 4_000;
export const WORKER_CONTAINER_HEALTH_RETRIES = 3;
export const WORKER_CONTAINER_LIVENESS_SCAN_INTERVAL_SECONDS = 10;
export const WORKER_CONTAINER_LIVENESS_SCAN_INTERVAL_MS =
  WORKER_CONTAINER_LIVENESS_SCAN_INTERVAL_SECONDS * 1000;
export const WORKER_CONTAINER_LIVENESS_MAX_JITTER_MS = 2_000;
export const WORKER_CONTAINER_LIVENESS_REMOTE_PROCESS_TIMEOUT_MS = 5_000;
export const WORKER_CONTAINER_LIVENESS_SSH_READY_TIMEOUT_MS = 5_000;
export const WORKER_CONTAINER_LIVENESS_REMOTE_COMMAND_TIMEOUT_MS = 6_000;
export const WORKER_CONTAINER_LIVENESS_DISCOVERY_BATCH_SIZE = 25;
/*
 * The fast monitor also walks a bounded primary-database page looking for
 * workers whose authoritative runtime identity has disappeared from Docker.
 * A page is intentionally larger than the unhealthy-container batch because
 * the first phase needs only one aggregate `docker ps` snapshot per server.
 * Actual recreate claims remain tightly capped to avoid a recovery storm when
 * an entire host has lost its Docker state.
 */
export const WORKER_MISSING_RUNTIME_SCAN_BATCH_SIZE = 250;
export const WORKER_MISSING_RUNTIME_RECOVERY_MAX_PER_CYCLE = 8;
export const WORKER_MISSING_RUNTIME_RECOVERY_MAX_PER_SERVER = 2;
export const WORKER_MISSING_RUNTIME_CONFIRMATION_MIN_AGE_MS = 5_000;
export const WORKER_MISSING_RUNTIME_OBSERVATION_TTL_MS = 10 * 60_000;
export const WORKER_CONTAINER_LIVENESS_REMOTE_PHASE_TIMEOUT_MS =
  WORKER_CONTAINER_LIVENESS_SSH_READY_TIMEOUT_MS +
  WORKER_CONTAINER_LIVENESS_REMOTE_COMMAND_TIMEOUT_MS;
export const WORKER_CONTAINER_LIVENESS_REMOTE_OBSERVATION_PHASES = 3;
export const WORKER_CONTAINER_LIVENESS_CRON_EXPRESSION = `*/${WORKER_CONTAINER_LIVENESS_SCAN_INTERVAL_SECONDS} * * * * *`;
export const WORKER_CONTAINER_STARTING_FAILURE_MIN_AGE_MS = 45_000;
export const WORKER_CONTAINER_STARTUP_FALLBACK_PROBES = 10;
export const WORKER_CONTAINER_STARTUP_FALLBACK_BOUND_MS =
  (WORKER_CONTAINER_HEALTH_START_INTERVAL_MS +
    WORKER_CONTAINER_HEALTH_TIMEOUT_MS) *
  WORKER_CONTAINER_STARTUP_FALLBACK_PROBES;
export const WORKER_LIVENESS_LIFECYCLE_LEASE_TTL_MS = 75_000;
export const WORKER_LIVENESS_LIFECYCLE_HEARTBEAT_MS = 15_000;
export const WORKER_LIVENESS_LOCAL_DOCKER_READ_TIMEOUT_MS = 5_000;
export const WORKER_LIVENESS_LIFECYCLE_REDRIVE_AFTER_MS = 60_000;
export const WORKER_LIVENESS_LIFECYCLE_REDRIVE_CLAIM_MS = 30_000;
export const WORKER_LIVENESS_COOLDOWN_STALE_GRACE_MS = 30_000;
export const WORKER_LIVENESS_LIFECYCLE_RECOVERY_BOUND_MS =
  WORKER_LIVENESS_LIFECYCLE_LEASE_TTL_MS +
  WORKER_CONTAINER_LIVENESS_SCAN_INTERVAL_MS +
  WORKER_CONTAINER_LIVENESS_MAX_JITTER_MS;

/*
 * Worst-case detector budget for an established runtime, through the second
 * immutable Docker observation. This includes each Docker probe's own timeout
 * and both sequential SSH connect/command deadlines. PostgreSQL, Redis and the
 * durable Kafka lifecycle request have their own client budgets and are not
 * hidden inside this detector-only number.
 */
export const WORKER_CONTAINER_FREEZE_DETECTOR_BOUND_MS =
  (WORKER_CONTAINER_HEALTH_INTERVAL_MS + WORKER_CONTAINER_HEALTH_TIMEOUT_MS) *
    WORKER_CONTAINER_HEALTH_RETRIES +
  WORKER_CONTAINER_LIVENESS_SCAN_INTERVAL_MS +
  WORKER_CONTAINER_LIVENESS_MAX_JITTER_MS +
  WORKER_CONTAINER_LIVENESS_REMOTE_PHASE_TIMEOUT_MS *
    WORKER_CONTAINER_LIVENESS_REMOTE_OBSERVATION_PHASES;

export function getWorkerContainerLivenessJitterMs(
  randomValue = Math.random()
): number {
  const normalized = Number.isFinite(randomValue)
    ? Math.min(0.999999999, Math.max(0, randomValue))
    : 0;

  return Math.floor(normalized * (WORKER_CONTAINER_LIVENESS_MAX_JITTER_MS + 1));
}
