export interface IKafkaConsumerHealthSnapshot {
  group_id: string;
  start_position?: 'committed' | 'latest-on-assignment';
  assignment_epoch?: number;
  assignments_ready?: boolean;
  assignment_positioning_count?: number;
  dispatch_authorized?: boolean;
  pending_dispatch_authorization_count?: number;
  topics: string[];
  connected: boolean;
  consuming: boolean;
  unhealthy?: boolean;
  stall_reason?: string;
  assignments?: Array<{ topic: string; partition: number }>;
  assigned_topics?: string[];
  partitions?: Array<{
    topic: string;
    partition: number;
    committed_offset: number | null;
    position_offset?: number | null;
    low_watermark?: number | null;
    high_watermark: number | null;
    effective_progress_offset?: number | null;
    lag: number;
  }>;
  lag?: number | null;
  lag_measurement_complete?: boolean;
  lag_measurement_failure_count?: number;
  last_lag_measurement_at?: number;
  high_watermark?: number | null;
  low_watermark?: number | null;
  committed_offset?: number | null;
  position_offset?: number | null;
  effective_progress_offset?: number | null;
  pending_count?: number;
  pending_queued_count?: number;
  pending_processing_count?: number;
  pending_settled_count?: number;
  oldest_pending_age_ms?: number;
  oldest_pending_no_progress_age_ms?: number;
  pending_stall_budget_ms?: number;
  restart_count: number;
  consecutive_stall_restart_count?: number;
  stall_recovery_exhausted?: boolean;
  pod_replacement_required?: boolean;
  pod_replacement_reason?: string;
  stall_restart_scope?: string;
  stall_restart_effective_scope?: 'all' | 'durable' | 'none';
  stall_restart_enabled?: boolean;
  last_message_at: number;
  last_commit_at: number;
  last_progress_at?: number;
  last_restart_at: number;
  last_watchdog_at?: number;
  last_error: string;
  missing?: boolean;
  registered_at?: number;
  missing_age_ms?: number;
  health_snapshot_missing_since?: number;
  health_snapshot_missing_age_ms?: number;
  health_snapshot_recovery_timeout_ms?: number;
  health_snapshot_recovery_exhausted?: boolean;
}

export interface IKafkaConsumerOwnerHealthSnapshot extends IKafkaConsumerHealthSnapshot {
  owner: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function getManagedKafkaConsumerHealthSnapshot(
  source: unknown
): IKafkaConsumerHealthSnapshot | null {
  if (!isRecord(source)) {
    return null;
  }

  const health = source.__health;
  if (typeof health !== 'function') {
    return null;
  }

  const snapshot = (health as () => unknown).call(source);
  if (!isRecord(snapshot)) {
    return null;
  }

  return snapshot as unknown as IKafkaConsumerHealthSnapshot;
}

export function getConsumerOwnerKafkaHealthSnapshot(
  owner: unknown
): IKafkaConsumerOwnerHealthSnapshot | null {
  if (!isRecord(owner)) {
    return null;
  }

  const snapshot = getManagedKafkaConsumerHealthSnapshot(owner.consumer);
  if (!snapshot) {
    return null;
  }

  return {
    owner: getConsumerOwnerName(owner),
    ...snapshot,
  };
}

export function getConsumerOwnerName(owner: unknown): string {
  if (!isRecord(owner)) {
    return 'unknown';
  }

  const constructorValue = owner.constructor;
  return typeof constructorValue === 'function' &&
    typeof constructorValue.name === 'string'
    ? constructorValue.name
    : 'unknown';
}

export function buildMissingKafkaConsumerHealthSnapshot(input: {
  owner: string;
  registeredAt: number;
  graceMs: number;
}): IKafkaConsumerOwnerHealthSnapshot {
  const now = Date.now();
  const missingAgeMs = Math.max(0, now - input.registeredAt);
  const unhealthy = missingAgeMs >= input.graceMs;

  return {
    owner: input.owner,
    group_id: '',
    topics: [],
    connected: false,
    consuming: false,
    assignments_ready: false,
    assignment_positioning_count: 0,
    dispatch_authorized: false,
    pending_dispatch_authorization_count: 0,
    unhealthy,
    stall_reason: unhealthy ? 'missing_consumer_health_snapshot' : undefined,
    lag: null,
    lag_measurement_complete: false,
    lag_measurement_failure_count: 0,
    last_lag_measurement_at: 0,
    low_watermark: null,
    high_watermark: null,
    committed_offset: null,
    position_offset: null,
    effective_progress_offset: null,
    pending_count: 0,
    pending_queued_count: 0,
    pending_processing_count: 0,
    pending_settled_count: 0,
    oldest_pending_age_ms: 0,
    oldest_pending_no_progress_age_ms: 0,
    restart_count: 0,
    consecutive_stall_restart_count: 0,
    stall_recovery_exhausted: false,
    pod_replacement_required: false,
    pod_replacement_reason: '',
    stall_restart_effective_scope: 'none',
    last_message_at: 0,
    last_commit_at: 0,
    last_progress_at: 0,
    last_restart_at: 0,
    last_watchdog_at: 0,
    last_error: unhealthy ? 'missing_consumer_health_snapshot' : '',
    missing: true,
    registered_at: input.registeredAt,
    missing_age_ms: missingAgeMs,
  };
}
