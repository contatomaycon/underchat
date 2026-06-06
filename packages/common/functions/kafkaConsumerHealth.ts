export interface IKafkaConsumerHealthSnapshot {
  group_id: string;
  topics: string[];
  connected: boolean;
  consuming: boolean;
  assignments?: Array<{ topic: string; partition: number }>;
  assigned_topics?: string[];
  restart_count: number;
  last_message_at: number;
  last_commit_at: number;
  last_restart_at: number;
  last_error: string;
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

  const constructorValue = owner.constructor;
  const ownerName =
    typeof constructorValue === 'function' &&
    typeof constructorValue.name === 'string'
      ? constructorValue.name
      : 'unknown';

  return {
    owner: ownerName,
    ...snapshot,
  };
}
