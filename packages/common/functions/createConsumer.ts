import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { randomUUID } from 'node:crypto';

export function createConsumer(
  kafka: KafkaClient,
  groupId: string
): KafkaConsumer {
  const uniqueGroupId = `${groupId}-${randomUUID()}`;

  return kafka.createConsumer(uniqueGroupId);
}
