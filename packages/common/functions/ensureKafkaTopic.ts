import { AdminClient, LibrdKafkaError } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { kafkaEnvironment } from '@core/config/environments';
import { toError, getErrorMessage } from './toError';

function createAdminClient(kafka: KafkaClient): AdminClient {
  const protocol = kafkaEnvironment.securityProtocol.toLowerCase();

  const config: Record<string, string | boolean> = {
    'client.id': 'kafka-admin',
    'metadata.broker.list': kafka.getBroker(),
    'security.protocol': protocol,
  };

  if (protocol !== 'plaintext') {
    const saslMechanism = kafkaEnvironment.saslMechanism;
    const username = kafkaEnvironment.kafkaUsername;
    const password = kafkaEnvironment.kafkaPassword;

    if (saslMechanism && username && password) {
      config['sasl.mechanism'] = saslMechanism;
      config['sasl.username'] = username;
      config['sasl.password'] = password;
    }
  }

  if (protocol === 'sasl_ssl' || protocol === 'ssl') {
    config['enable.ssl.certificate.verification'] = false;
  }

  return AdminClient.create(config);
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
  numPartitions: number,
  replicationFactor = 1,
  timeoutMs = 60000
): Promise<void> {
  const admin = createAdminClient(kafka);

  try {
    await createTopic(
      admin,
      topic,
      numPartitions,
      replicationFactor,
      timeoutMs
    );
  } finally {
    (admin as any).disconnect();
  }
}
