import { inject, injectable } from 'tsyringe';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import {
  durableWorkerIdFromKafkaTopic,
  resolveKafkaTopicConfig,
} from '@core/common/functions/kafkaTopicConfig';

/**
 * Generic topic provisioner used by control-plane processes.
 *
 * This service deliberately has no database or repository dependency. Durable
 * per-worker topics are rejected here and can only be mutated through the
 * Balance-only WorkerKafkaTopicAdminService.
 */
@injectable()
export class KafkaService {
  constructor(@inject('Kafka') private readonly kafka: KafkaClient) {}

  async createTopics(
    topics: string[],
    numPartitions?: number,
    replicationFactor?: number,
    timeoutMs = 30000
  ): Promise<void> {
    if (topics.length === 0) {
      return;
    }

    const protectedTopic = topics.find((topic) =>
      durableWorkerIdFromKafkaTopic(topic.trim())
    );
    if (protectedTopic) {
      throw new Error(
        `generic_durable_worker_topic_provisioning_disabled:${protectedTopic}`
      );
    }

    await Promise.all(
      topics.map((topic) => {
        const configuredTopology = resolveKafkaTopicConfig(topic);
        return ensureKafkaTopic(
          this.kafka,
          topic,
          numPartitions ?? configuredTopology.numPartitions,
          replicationFactor ?? configuredTopology.replicationFactor,
          timeoutMs
        );
      })
    );
  }

  async deleteTopics(topics: string[]): Promise<void> {
    if (topics.length === 0) {
      return;
    }

    console.warn(
      '[worker-kafka-topic-audit]',
      JSON.stringify({
        type: 'worker_kafka_topic_audit',
        event: 'worker_topics.delete.admin_boundary_denied',
        timestamp: new Date().toISOString(),
        worker_id: null,
        account_id: null,
        operation: 'delete',
        lifecycle_operation_id: null,
        trace_id: null,
        topics,
        reason: 'runtime_generic_kafka_topic_deletion_disabled',
      })
    );
    throw new Error('runtime_generic_kafka_topic_deletion_disabled');
  }
}
