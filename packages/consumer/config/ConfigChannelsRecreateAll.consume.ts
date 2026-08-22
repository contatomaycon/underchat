import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { IConfigChannelsRecreateAllPayload } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';
import { IConfigChannelsRecreateAllCompleted } from '@core/common/interfaces/IConfigChannelsRecreateAllCompleted';
import { channelsConfigCentrifugo } from '@core/common/functions/centrifugoQueue';
import { createI18nInstance } from '@core/common/functions/createI18nInstance';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import type { KafkaConsumerRunnerContext } from '@core/common/interfaces/KafkaConsumerRunnerOptions';
import { ConfigChannelsRecreateAllPlannerService } from '@core/services/configChannelsRecreateAllPlanner.service';
import { ConfigChannelsRecreateAllExecutorService } from '@core/services/configChannelsRecreateAllExecutor.service';
import { ConfigChannelsRecreateBatchIdentityConflictError } from '@core/repositories/config/ConfigChannelsRecreateBatch.repository';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { v5 as uuidv5 } from 'uuid';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKER_STATUSES = new Set<string>(Object.values(EWorkerStatus));
const WORKER_TYPES = new Set<string>(Object.values(EWorkerType));
const WORKER_SESSION_STORAGES = new Set<string>(
  Object.values(EWorkerSessionStorage)
);

@singleton()
export class ConfigChannelsRecreateAllConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IConfigChannelsRecreateAllPayload> | null =
    null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ConfigChannelsRecreateAllPlannerService)
    private readonly plannerService: ConfigChannelsRecreateAllPlannerService,
    @inject(ConfigChannelsRecreateAllExecutorService)
    private readonly executorService: ConfigChannelsRecreateAllExecutorService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    this.executorService.start();
    const topic = this.kafkaServiceQueueService.configChannelsRecreateAll();
    this.runner = new KafkaConsumerRunner<IConfigChannelsRecreateAllPayload>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-config-channels-recreate-all',
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => data.account_id,
      preserveEntityOrder: true,
      handle: (data, context) => this.processRecreateAll(data, context),
      maxRetries: 1,
      classifyError: (_data, _context, error) =>
        error instanceof ConfigChannelsRecreateBatchIdentityConflictError
          ? 'terminal'
          : 'retryable',
      shouldContinueRetryWithoutCommit: (_data, _context, error) =>
        !(error instanceof ConfigChannelsRecreateBatchIdentityConflictError),
      onFailed: (data, context, error) => {
        console.error(
          '[ConfigChannelsRecreateAllConsume] bulk recreation failed',
          {
            account_id: data.account_id,
            request_id: data.request_id,
            partition: context.partition,
            offset: context.offset,
            error,
          }
        );
      },
      onDiscarded: (data, context) =>
        this.publishDiscarded(data.account_id, context.assertActive),
      logger: console,
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
    await this.executorService.close();
  }

  private parseMessage(
    value: Buffer | null
  ): IConfigChannelsRecreateAllPayload | null {
    if (!value) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(value.toString());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }

      const candidate = parsed as Record<string, unknown>;
      const accountId = this.requiredUuid(candidate.account_id);
      const requestId =
        candidate.request_id === undefined
          ? undefined
          : this.requiredUuid(candidate.request_id);
      const account =
        candidate.account === undefined
          ? undefined
          : this.requiredUuid(candidate.account);
      const status = candidate.status;
      const type = candidate.type;
      const sessionStorage = candidate.session_storage;
      const name = this.optionalString(candidate.name);
      const number = this.optionalString(candidate.number);
      if (
        !accountId ||
        (candidate.request_id !== undefined && !requestId) ||
        (candidate.account !== undefined && !account) ||
        (status !== undefined &&
          (typeof status !== 'string' || !WORKER_STATUSES.has(status))) ||
        (type !== undefined &&
          (typeof type !== 'string' || !WORKER_TYPES.has(type))) ||
        (sessionStorage !== undefined &&
          (typeof sessionStorage !== 'string' ||
            !WORKER_SESSION_STORAGES.has(sessionStorage))) ||
        name === null ||
        number === null
      ) {
        return null;
      }

      return {
        account_id: accountId,
        ...(requestId ? { request_id: requestId } : {}),
        ...(status ? { status: status as EWorkerStatus } : {}),
        ...(type ? { type: type as EWorkerType } : {}),
        ...(sessionStorage
          ? { session_storage: sessionStorage as EWorkerSessionStorage }
          : {}),
        ...(account ? { account } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(number !== undefined ? { number } : {}),
      };
    } catch {
      return null;
    }
  }

  private requiredUuid(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return UUID_PATTERN.test(normalized) ? normalized : null;
  }

  private optionalString(value: unknown): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    return typeof value === 'string' ? value : null;
  }

  private async publishCompleted(
    accountId: string,
    success: number,
    errors: number
  ): Promise<void> {
    const payload: IConfigChannelsRecreateAllCompleted = {
      type: 'recreate_all_completed',
      account_id: accountId,
      success,
      errors,
    };

    await this.centrifugoService.publish(channelsConfigCentrifugo(), payload);
  }

  private async processRecreateAll(
    data: IConfigChannelsRecreateAllPayload,
    context: KafkaConsumerRunnerContext<IConfigChannelsRecreateAllPayload>
  ): Promise<void> {
    context.assertActive();
    const t = await createI18nInstance('pt');
    context.assertActive();
    await this.plannerService.prepare(
      t,
      {
        requestId: this.resolveRequestId(data, context),
        topic: context.topic,
        partition: context.partition,
        offset: context.offset,
        accountId: data.account_id,
      },
      {
        status: data.status,
        type: data.type,
        ...(data.session_storage
          ? { session_storage: data.session_storage }
          : {}),
        account: data.account,
        name: data.name,
        number: data.number,
      },
      { assertActive: context.assertActive }
    );
    context.assertActive();
    this.executorService.kick();
  }

  private resolveRequestId(
    data: IConfigChannelsRecreateAllPayload,
    context: KafkaConsumerRunnerContext<IConfigChannelsRecreateAllPayload>
  ): string {
    const requestId = data.request_id?.trim();
    if (requestId && UUID_PATTERN.test(requestId)) {
      return requestId;
    }

    return uuidv5(
      `${context.topic}:${context.partition}:${context.offset}`,
      uuidv5.URL
    );
  }

  private async publishDiscarded(
    accountId: string,
    assertActive: () => void
  ): Promise<void> {
    assertActive();
    await this.publishCompleted(accountId, 0, 1);
    assertActive();
  }
}
