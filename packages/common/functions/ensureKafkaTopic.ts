import type { AdminClient, LibrdKafkaError } from 'node-rdkafka';
import type { KafkaClient } from '@core/plugins/kafkaStreams';
import { toError, getErrorMessage } from './toError';
import { rdkafka } from '@core/common/vendors/nodeRdkafka';
import { buildNodeKafkaAdminConfig } from './kafkaAdminConfig';
import { durableWorkerIdFromKafkaTopic } from './kafkaTopicConfig';

const TOPIC_ENSURE_SUCCESS_TTL_MS = 30_000;
const TOPIC_ALREADY_EXISTS_ERROR_CODE =
  rdkafka.CODES?.ERRORS?.ERR_TOPIC_ALREADY_EXISTS ?? 36;
const INVALID_PARTITIONS_ERROR_CODE =
  rdkafka.CODES?.ERRORS?.ERR_INVALID_PARTITIONS ?? 37;

interface ITopicEnsureCacheEntry {
  partitionFloor: number;
  expiresAt: number;
}

const successfulTopicEnsures = new Map<string, ITopicEnsureCacheEntry>();
const inFlightTopicEnsures = new Map<string, Promise<void>>();

function createAdminClient(kafka: KafkaClient): AdminClient {
  return rdkafka.AdminClient.create(
    buildNodeKafkaAdminConfig(
      kafka.getBroker(),
      'kafka-provisioner',
      'provisioner'
    )
  );
}

async function createTopic(
  admin: AdminClient,
  topic: string,
  numPartitions: number,
  replicationFactor: number,
  timeoutMs = 5000
): Promise<'created' | 'already-exists'> {
  return new Promise<'created' | 'already-exists'>((resolve, reject) => {
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
            errorCode === TOPIC_ALREADY_EXISTS_ERROR_CODE ||
            errorMessage.includes('Topic already exists') ||
            errorMessage.includes('already exists')
          ) {
            resolve('already-exists');
            return;
          }

          reject(toError(err));
          return;
        }
        resolve('created');
      }
    );
  });
}

function ensureTopicPartitionFloor(
  admin: AdminClient,
  topic: string,
  numPartitions: number,
  timeoutMs: number
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    (admin as any).createPartitions(
      topic,
      numPartitions,
      timeoutMs,
      (err: LibrdKafkaError | null) => {
        if (!err) {
          resolve();
          return;
        }

        const errorMessage = getErrorMessage(err);
        const normalizedMessage = errorMessage.toLowerCase();
        const errorCode = (err as any).code ?? (err as any).errno;

        /*
         * Kafka rejects createPartitions when the topic already has the
         * requested number (or more). That is the desired idempotent result:
         * partition counts must never be reduced automatically.
         */
        const isAlreadyAtOrAboveFloor =
          errorCode === INVALID_PARTITIONS_ERROR_CODE &&
          (normalizedMessage.includes('topic already has') ||
            normalizedMessage.includes('would not be an increase'));
        if (isAlreadyAtOrAboveFloor) {
          resolve();
          return;
        }

        reject(toError(err));
      }
    );
  });
}

async function ensureKafkaTopicUncached(
  kafka: KafkaClient,
  topic: string,
  numPartitions: number,
  replicationFactor = 1,
  timeoutMs = 60000
): Promise<void> {
  const admin = createAdminClient(kafka);

  try {
    const creationResult = await createTopic(
      admin,
      topic,
      numPartitions,
      replicationFactor,
      timeoutMs
    );

    /*
     * A broker with auto.create enabled may race the explicit create and use
     * its default (one partition). Reconcile the floor whenever the topic was
     * already present so all Service replicas can participate. This operation
     * only expands; it never remaps an already wider topic or changes RF.
     */
    /*
     * Every existing Kafka topic necessarily has at least one partition.
     * Worker-scoped topics deliberately use that floor, so issuing
     * createPartitions(topic, 1) on every reconnect only creates controller
     * churn (and an expected ERR_INVALID_PARTITIONS) across thousands of
     * topics. Reserve the administrative expansion for real floors > 1.
     */
    if (creationResult === 'already-exists' && numPartitions > 1) {
      await ensureTopicPartitionFloor(admin, topic, numPartitions, timeoutMs);
    }
  } finally {
    (admin as any).disconnect();
  }
}

async function ensureKafkaTopicWithPolicy(
  kafka: KafkaClient,
  topic: string,
  numPartitions: number,
  replicationFactor: number,
  timeoutMs: number
): Promise<void> {
  const normalizedTopic = topic.trim();
  const durableWorkerId = durableWorkerIdFromKafkaTopic(normalizedTopic);
  if (durableWorkerId) {
    throw new Error(
      `generic_durable_worker_topic_provisioning_disabled:${normalizedTopic}`
    );
  }

  if (!normalizedTopic) {
    throw new Error('Kafka topic must not be empty');
  }
  if (!Number.isSafeInteger(numPartitions) || numPartitions <= 0) {
    throw new Error('Kafka topic partition count must be a positive integer');
  }
  if (!Number.isSafeInteger(replicationFactor) || replicationFactor <= 0) {
    throw new Error(
      'Kafka topic replication factor must be a positive integer'
    );
  }

  const topicKey = `${kafka.getBroker()}\u0000${normalizedTopic}`;
  const now = Date.now();
  const cached = successfulTopicEnsures.get(topicKey);
  if (
    cached &&
    cached.expiresAt > now &&
    cached.partitionFloor >= numPartitions
  ) {
    return;
  }

  const operationKey = `${topicKey}\u0000${numPartitions}\u0000${replicationFactor}`;
  const existingOperation = inFlightTopicEnsures.get(operationKey);
  if (existingOperation) {
    return existingOperation;
  }

  const operation = ensureKafkaTopicUncached(
    kafka,
    normalizedTopic,
    numPartitions,
    replicationFactor,
    timeoutMs
  ).then(() => {
    const existing = successfulTopicEnsures.get(topicKey);
    successfulTopicEnsures.set(topicKey, {
      partitionFloor: Math.max(
        numPartitions,
        existing?.partitionFloor ?? numPartitions
      ),
      expiresAt: Date.now() + TOPIC_ENSURE_SUCCESS_TTL_MS,
    });
  });
  inFlightTopicEnsures.set(operationKey, operation);

  try {
    await operation;
  } finally {
    if (inFlightTopicEnsures.get(operationKey) === operation) {
      inFlightTopicEnsures.delete(operationKey);
    }
  }
}

/**
 * Reconciles a topic's partition floor without repeatedly hammering the Kafka
 * controller from every producer/consumer in the same process. The cache is
 * deliberately short-lived so an externally deleted and auto-recreated topic
 * is healed on a later call.
 */
export async function ensureKafkaTopic(
  kafka: KafkaClient,
  topic: string,
  numPartitions: number,
  replicationFactor = 1,
  timeoutMs = 60000
): Promise<void> {
  return ensureKafkaTopicWithPolicy(
    kafka,
    topic,
    numPartitions,
    replicationFactor,
    timeoutMs
  );
}
