import { FastifyInstance } from 'fastify';
import { inject, singleton } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ServerBuildExecutorService } from '@core/services/serverBuildExecutor.service';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

interface IBuildVersionCancelPayload {
  server_build_job_id: string;
}

@singleton()
export class BuildVersionCancelConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IBuildVersionCancelPayload> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ServerBuildExecutorService)
    private readonly serverBuildExecutorService: ServerBuildExecutorService
  ) {}

  private parsePayload(
    value: Buffer | null
  ): IBuildVersionCancelPayload | null {
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        value.toString('utf8')
      ) as IBuildVersionCancelPayload;
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

    const topic = this.kafkaServiceQueueService.buildVersionCancelRequest();
    this.runner = new KafkaConsumerRunner<IBuildVersionCancelPayload>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-build-version-cancel',
      parse: (message) => this.parsePayload(message.value),
      resolveEntityKey: (payload) => payload.server_build_job_id,
      handle: (payload) =>
        this.serverBuildExecutorService.requestCancel(
          payload.server_build_job_id
        ),
      onInvalidMessage: () => {
        server.log.warn('Skipping invalid build cancel payload');
      },
      onFailed: (payload, _context, error) => {
        server.log.error(
          { err: error, server_build_job_id: payload.server_build_job_id },
          'Failed to execute build cancel payload'
        );
      },
      maxRetries: 3,
      retryDelaysMs: [1000, 5000],
      logger: server.log,
    });

    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
  }

  public async close(): Promise<void> {
    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }
}
