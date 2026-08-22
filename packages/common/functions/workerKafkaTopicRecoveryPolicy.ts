import type { KafkaClient } from '@core/plugins/kafkaStreams';

/**
 * Workers are runtime-only Kafka principals. Topic creation and deletion are
 * exclusively owned by the control plane before a worker starts consuming.
 */
export function recoverKafkaTopicForProduce(
  kafka: KafkaClient,
  topic: string
): Promise<void> {
  void kafka;
  void topic;
  /*
   * Preserve the producer's reconnect-and-retry path for transient leader and
   * metadata errors without performing any administrative mutation. A topic
   * that is genuinely absent fails closed on the bounded second attempt.
   */
  return Promise.resolve();
}
