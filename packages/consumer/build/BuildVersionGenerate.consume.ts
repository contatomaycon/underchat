import { FastifyInstance } from 'fastify';
import { inject, singleton } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { IBuildVersionGeneratePayload } from '@core/common/interfaces/IBuildVersionGeneratePayload';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ServerBuildExecutorService } from '@core/services/serverBuildExecutor.service';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

interface IBuildVersionGenerateLegacyPayload {
  server_build_job_id: string;
  build_type?: undefined;
  trigger?: undefined;
}

type BuildVersionGenerateConsumerPayload =
  | IBuildVersionGeneratePayload
  | IBuildVersionGenerateLegacyPayload;

@singleton()
export class BuildVersionGenerateConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<BuildVersionGenerateConsumerPayload> | null =
    null;
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
  ): BuildVersionGenerateConsumerPayload | null {
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(value.toString('utf8')) as
        | (Partial<IBuildVersionGeneratePayload> & {
            server_build_job_id?: string;
            build_type?: EServerBuildType;
          })
        | null;

      if (!parsed?.server_build_job_id) {
        return null;
      }

      if (typeof parsed.build_type !== 'undefined') {
        const isValidBuildType =
          parsed.build_type === EServerBuildType.baileys ||
          parsed.build_type === EServerBuildType.wwebjs ||
          parsed.build_type === EServerBuildType.whatsmeow ||
          parsed.build_type === EServerBuildType.balance_api;

        if (!isValidBuildType) {
          return null;
        }

        return {
          server_build_job_id: parsed.server_build_job_id,
          build_type: parsed.build_type,
          trigger: parsed.trigger,
        };
      }

      return {
        server_build_job_id: parsed.server_build_job_id,
      };
    } catch {
      return null;
    }
  }

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer && this.isRunning) {
      return;
    }

    const topic = this.kafkaServiceQueueService.buildVersionGenerateRequest();
    this.runner = new KafkaConsumerRunner<BuildVersionGenerateConsumerPayload>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-build-version-generate',
      parse: (message) => this.parsePayload(message.value),
      resolveEntityKey: (payload) =>
        payload.build_type
          ? `${payload.server_build_job_id}:${payload.build_type}`
          : payload.server_build_job_id,
      handle: (payload) => this.processPayload(payload),
      onInvalidMessage: () => {
        server.log.warn('Skipping invalid build generate payload');
      },
      onFailed: (payload, _context, error) => {
        server.log.error(
          {
            err: error,
            server_build_job_id: payload.server_build_job_id,
            build_type: payload.build_type,
          },
          'Failed to execute build generate payload'
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

  private async processPayload(
    payload: BuildVersionGenerateConsumerPayload
  ): Promise<void> {
    if (payload.build_type) {
      await this.serverBuildExecutorService.executeBuildJobItem(
        payload.server_build_job_id,
        payload.build_type
      );
      return;
    }

    await this.serverBuildExecutorService.executeBuildJob(
      payload.server_build_job_id
    );
  }
}
