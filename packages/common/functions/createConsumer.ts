import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';

export function createConsumer(
  kafka: KafkaClient,
  groupId: string
): KafkaConsumer {
  return kafka.createConsumer(groupId);
}
