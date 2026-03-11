import { FastifyInstance } from 'fastify';
import { inject, singleton } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { commitOffset } from '@core/common/functions/commitOffset';
import { ServerBuildExecutorService } from '@core/services/serverBuildExecutor.service';

interface IBuildVersionGeneratePayload {
  server_build_job_id: string;
}

@singleton()
export class BuildVersionGenerateConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ServerBuildExecutorService)
    private readonly serverBuildExecutorService: ServerBuildExecutorService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  private parsePayload(
    value: Buffer | null
  ): IBuildVersionGeneratePayload | null {
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        value.toString('utf8')
      ) as IBuildVersionGeneratePayload;

      if (!parsed?.server_build_job_id) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer && this.isRunning) {
      return;
    }

    const topic = this.kafkaServiceQueueService.buildVersionGenerateRequest();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-build-version-generate'
    );

    this.consumer.on('data', async (message) => {
      const payload = this.parsePayload(message.value);

      if (!payload) {
        server.log.warn('Skipping invalid build generate payload');
        await commitOffset(
          this.consumerOrThrow,
          topic,
          message.partition,
          message.offset
        );
        return;
      }

      try {
        await this.serverBuildExecutorService.executeBuildJob(
          payload.server_build_job_id
        );
      } catch (error) {
        server.log.error(
          { err: error, server_build_job_id: payload.server_build_job_id },
          'Failed to execute build generate payload'
        );
      } finally {
        await commitOffset(
          this.consumerOrThrow,
          topic,
          message.partition,
          message.offset
        );
      }
    });

    this.consumer.on('event.error', (err) => {
      handleConsumerError(err, topic);
    });

    connectConsumer(this.consumer, topic, () => {
      this.isRunning = true;
    });
  }

  public async close(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    try {
      this.isRunning = false;
      await new Promise<void>((resolve) => {
        const consumer = this.consumer;
        if (!consumer) {
          resolve();
          return;
        }

        consumer.unsubscribe();
        consumer.disconnect(resolve);
      });
    } finally {
      this.consumer = null;
    }
  }
}
