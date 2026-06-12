import { inject, injectable } from 'tsyringe';
import type { MessageHeader } from 'node-rdkafka';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KAFKA_GLOBAL_TOPIC_CONFIG } from '@core/common/functions/kafkaTopicConfig';
import { KafkaService } from '@core/services/kafka.service';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { ConnectionLifecycleDebugService } from '@core/services/connectionLifecycleDebug.service';

@injectable()
export class WorkerLifecycleQueueService {
  constructor(
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaService)
    private readonly kafkaService: KafkaService,
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService
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
    const headers: MessageHeader[] = [];

    try {
      void this.connectionLifecycleDebugService.log(
        'manager.lifecycle_queue.publish',
        {
          trace_id: payload.debug_trace_id,
          layer: 'manager',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          action: payload.action,
          source: payload.source,
          topic: this.topic(),
        }
      );
      await this.streamProducerService.send(
        this.topic(),
        payload,
        payload.worker_id,
        headers
      );
      void this.connectionLifecycleDebugService.log(
        'manager.lifecycle_queue.published',
        {
          trace_id: payload.debug_trace_id,
          layer: 'manager',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          action: payload.action,
          source: payload.source,
          topic: this.topic(),
        }
      );
    } catch (error) {
      void this.connectionLifecycleDebugService.log(
        'manager.lifecycle_queue.publish_error',
        {
          trace_id: payload.debug_trace_id,
          layer: 'manager',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          action: payload.action,
          source: payload.source,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }
}
