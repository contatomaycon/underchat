import type { KafkaConsumer } from 'node-rdkafka';
import type { KafkaClient } from '@core/plugins/kafkaStreams';

export function createConsumer(
  kafka: KafkaClient,
  groupId: string
): KafkaConsumer {
  return kafka.createConsumer(groupId);
}
