import type { KafkaClient } from '@core/plugins/kafkaStreams';
import { ensureKafkaTopic } from './ensureKafkaTopic';
import { resolveKafkaTopicConfig } from './kafkaTopicConfig';

/**
 * Control-plane recovery for non-durable global topics.
 *
 * Worker builds replace this module through their tsconfig path map with the
 * fail-closed worker policy. This keeps Kafka administration out of worker
 * artifacts while preserving the existing recovery behavior elsewhere.
 */
export async function recoverKafkaTopicForProduce(
  kafka: KafkaClient,
  topic: string
): Promise<void> {
  const topicConfig = resolveKafkaTopicConfig(topic);
  await ensureKafkaTopic(
    kafka,
    topic,
    topicConfig.numPartitions,
    topicConfig.replicationFactor
  );
}
