import {
  buildMissingKafkaConsumerHealthSnapshot,
  getConsumerOwnerKafkaHealthSnapshot,
  getConsumerOwnerName,
  type IKafkaConsumerOwnerHealthSnapshot,
} from '@core/common/functions/kafkaConsumerHealth';

export interface IWorkerConsumer {
  execute?: () => Promise<void>;
  close?: () => Promise<void>;
  restart?: () => Promise<void>;
}

interface IRegisterWorkerConsumerOptions {
  monitorKafkaHealth?: boolean;
}

interface IRegisteredWorkerConsumer {
  consumer: IWorkerConsumer;
  registeredAt: number;
  monitorKafkaHealth: boolean;
}

const consumers: IRegisteredWorkerConsumer[] = [];
let supervisorTimer: NodeJS.Timeout | null = null;

const SUPERVISOR_INTERVAL_MS = Math.max(
  1000,
  Number(process.env.KAFKA_CONSUMER_SUPERVISOR_INTERVAL_MS) || 30000
);
const MISSING_SNAPSHOT_GRACE_MS = Math.max(
  1000,
  Number(process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS) || 120000
);

export function registerWorkerConsumer(
  consumer: IWorkerConsumer,
  options: IRegisterWorkerConsumerOptions = {}
): void {
  consumers.push({
    consumer,
    registeredAt: Date.now(),
    monitorKafkaHealth: options.monitorKafkaHealth !== false,
  });
}

export function getWorkerConsumers(): IWorkerConsumer[] {
  return consumers.map((item) => item.consumer);
}

export function getKafkaConsumerHealthSnapshots(): IKafkaConsumerOwnerHealthSnapshot[] {
  return consumers.filter(shouldMonitorKafkaHealth).map((item) => {
    const snapshot = getConsumerOwnerKafkaHealthSnapshot(item.consumer);
    if (snapshot) {
      return {
        ...snapshot,
        registered_at: item.registeredAt,
      };
    }

    return buildMissingKafkaConsumerHealthSnapshot({
      owner: getConsumerOwnerName(item.consumer),
      registeredAt: item.registeredAt,
      graceMs: MISSING_SNAPSHOT_GRACE_MS,
    });
  });
}

export function getKafkaConsumerHealthSummary() {
  const snapshots = getKafkaConsumerHealthSnapshots();
  return {
    expected: snapshots.length,
    active: snapshots.filter((snapshot) => snapshot.missing !== true).length,
    missing: snapshots.filter((snapshot) => snapshot.missing === true).length,
    unhealthy: snapshots.filter((snapshot) => snapshot.unhealthy === true)
      .length,
  };
}

export function hasUnhealthyKafkaConsumer(): boolean {
  return getKafkaConsumerHealthSnapshots().some(
    (snapshot) => snapshot.unhealthy === true
  );
}

export function startKafkaConsumerSupervisor(log: {
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}): void {
  if (supervisorTimer) {
    return;
  }

  supervisorTimer = setInterval(() => {
    void restartUnhealthyConsumers(log);
  }, SUPERVISOR_INTERVAL_MS);
  supervisorTimer.unref?.();
}

async function restartUnhealthyConsumers(log: {
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}): Promise<void> {
  for (const item of consumers.filter(shouldMonitorKafkaHealth)) {
    const consumer = item.consumer;
    const snapshot =
      getConsumerOwnerKafkaHealthSnapshot(consumer) ??
      buildMissingKafkaConsumerHealthSnapshot({
        owner: getConsumerOwnerName(consumer),
        registeredAt: item.registeredAt,
        graceMs: MISSING_SNAPSHOT_GRACE_MS,
      });
    if (!snapshot?.unhealthy) {
      continue;
    }

    try {
      log.warn(
        {
          owner: snapshot.owner,
          group_id: snapshot.group_id,
          topics: snapshot.topics,
          stall_reason: snapshot.stall_reason,
          restart_count: snapshot.restart_count,
        },
        'Kafka consumer supervisor restarting unhealthy owner'
      );

      if (consumer.restart) {
        await consumer.restart();
        continue;
      }

      if (consumer.close) {
        await consumer.close();
      } else {
        forceResetConsumerOwner(consumer);
      }
      await consumer.execute?.();
    } catch (err) {
      log.error(
        {
          err,
          owner: snapshot.owner,
          group_id: snapshot.group_id,
          topics: snapshot.topics,
        },
        'Kafka consumer supervisor failed to restart owner'
      );
    }
  }
}

function shouldMonitorKafkaHealth(item: IRegisteredWorkerConsumer): boolean {
  return item.monitorKafkaHealth;
}

function forceResetConsumerOwner(consumer: IWorkerConsumer): void {
  const owner = consumer as IWorkerConsumer & Record<string, unknown>;
  const kafkaConsumer = owner.consumer as
    | { unsubscribe?: () => void; disconnect?: (cb?: () => void) => void }
    | null
    | undefined;

  try {
    kafkaConsumer?.unsubscribe?.();
  } catch {}
  try {
    kafkaConsumer?.disconnect?.(() => {});
  } catch {}

  owner.consumer = null;
  owner.isRunning = false;
  clearMap(owner.lastMessageTypeByChatId);
}

function clearMap(value: unknown): void {
  if (value instanceof Map) {
    value.clear();
  }
}
