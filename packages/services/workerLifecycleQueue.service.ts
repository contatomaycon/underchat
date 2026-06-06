import { inject, injectable } from 'tsyringe';
import type { MessageHeader } from 'node-rdkafka';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KAFKA_GLOBAL_TOPIC_CONFIG } from '@core/common/functions/kafkaTopicConfig';
import { KafkaService } from '@core/services/kafka.service';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { recordConnectionLifecycle } from '@core/plugins/telemetry/connectionLifecycleDebug';

const CONNECTION_LIFECYCLE_ID_HEADER = 'x-connection-lifecycle-id';

@injectable()
export class WorkerLifecycleQueueService {
  constructor(
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaService)
    private readonly kafkaService: KafkaService
  ) {}

  getNumPartitions(): number {
    return KAFKA_GLOBAL_TOPIC_CONFIG.numPartitions;
  }

  getReplicationFactor(): number {
    return KAFKA_GLOBAL_TOPIC_CONFIG.replicationFactor;
  }

  topic(): string {
    return this.kafkaServiceQueueService.workerLifecycleRequest();
  }

  async ensure(): Promise<void> {
    await this.kafkaService.createTopics(
      [this.topic()],
      this.getNumPartitions(),
      this.getReplicationFactor()
    );
  }

  async publish(payload: IWorkerLifecycleQueueMessage): Promise<void> {
    const headers: MessageHeader[] = [
      {
        [CONNECTION_LIFECYCLE_ID_HEADER]: payload.connection_lifecycle_id,
      },
    ];

    recordConnectionLifecycle({
      stage: 'connection.manager.lifecycle_queue.enqueue_start',
      decision: 'enqueue_worker_lifecycle',
      outcome: 'started',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_type: payload.worker_type_id,
      worker_status_id: payload.worker_status_id,
      lifecycle_operation_id: payload.operation_id,
      lifecycle_action: payload.action,
      queue_topic: this.topic(),
      source: payload.source,
    });

    await this.streamProducerService.send(
      this.topic(),
      payload,
      payload.worker_id,
      headers
    );

    recordConnectionLifecycle({
      stage: 'connection.manager.lifecycle_queue.enqueue_success',
      decision: 'enqueue_worker_lifecycle',
      outcome: 'success',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_type: payload.worker_type_id,
      worker_status_id: payload.worker_status_id,
      lifecycle_operation_id: payload.operation_id,
      lifecycle_action: payload.action,
      queue_topic: this.topic(),
      source: payload.source,
    });
  }
}
