export interface IKafkaConsumerHealthSnapshot {
  group_id: string;
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
    high_watermark: number | null;
    lag: number;
  }>;
  lag?: number;
  high_watermark?: number | null;
  committed_offset?: number | null;
  pending_count?: number;
  oldest_pending_age_ms?: number;
  restart_count: number;
  consecutive_stall_restart_count?: number;
  stall_restart_scope?: string;
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
    unhealthy,
    stall_reason: unhealthy ? 'missing_consumer_health_snapshot' : undefined,
    lag: 0,
    pending_count: 0,
    oldest_pending_age_ms: 0,
    restart_count: 0,
    consecutive_stall_restart_count: 0,
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
