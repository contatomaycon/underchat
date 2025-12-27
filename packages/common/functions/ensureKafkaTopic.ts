import { AdminClient, LibrdKafkaError } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { toError, getErrorMessage } from './toError';

function createAdminClient(kafka: KafkaClient): AdminClient {
  return AdminClient.create({
    'client.id': 'kafka-admin',
    'metadata.broker.list': kafka.getBroker(),
  });
}


async function createTopic(
  admin: AdminClient,
  topic: string,
  numPartitions: number,
  replicationFactor: number,
  timeoutMs = 5000
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    (admin as any).createTopic(
      {
        topic,
        num_partitions: numPartitions,
        replication_factor: replicationFactor,
      },
      timeoutMs,
      (err: LibrdKafkaError | null) => {
        if (err) {
          const errorMessage = getErrorMessage(err);
          const errorCode = (err as any).code ?? (err as any).errno;

          if (
            errorCode === 36 ||
            errorMessage.includes('Topic already exists') ||
            errorMessage.includes('already exists')
          ) {
            resolve();
            return;
          }

          reject(toError(err));
          return;
        }
        resolve();
      }
    );
  });
}

export async function ensureKafkaTopic(
  kafka: KafkaClient,
  topic: string,
  numPartitions = 1,
  replicationFactor = 1,
  timeoutMs = 60000
): Promise<void> {
  const admin = createAdminClient(kafka);

  try {
    await createTopic(admin, topic, numPartitions, replicationFactor, timeoutMs);
  } finally {
    (admin as any).disconnect();
  }
}
