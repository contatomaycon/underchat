import {
  getConsumerOwnerKafkaHealthSnapshot,
  type IKafkaConsumerOwnerHealthSnapshot,
} from '@core/common/functions/kafkaConsumerHealth';

export interface IWorkerConsumer {
  execute?: () => Promise<void>;
  close?: () => Promise<void>;
  restart?: () => Promise<void>;
}

const consumers: IWorkerConsumer[] = [];
let supervisorTimer: NodeJS.Timeout | null = null;

const SUPERVISOR_INTERVAL_MS = Math.max(
  1000,
  Number(process.env.KAFKA_CONSUMER_SUPERVISOR_INTERVAL_MS) || 30000
);

export function registerWorkerConsumer(consumer: IWorkerConsumer): void {
  consumers.push(consumer);
}

export function getWorkerConsumers(): IWorkerConsumer[] {
  return [...consumers];
}

export function getKafkaConsumerHealthSnapshots(): IKafkaConsumerOwnerHealthSnapshot[] {
  return consumers
    .map((consumer) => getConsumerOwnerKafkaHealthSnapshot(consumer))
    .filter(
      (snapshot): snapshot is IKafkaConsumerOwnerHealthSnapshot =>
        snapshot !== null
    );
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
  for (const consumer of consumers) {
    const snapshot = getConsumerOwnerKafkaHealthSnapshot(consumer);
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
