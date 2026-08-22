import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateProfileStatusExternalId } from '@core/common/interfaces/IUpdateProfileStatusExternalId';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { WhatsappRuntimeFenceService } from '@core/services/whatsappRuntimeFence.service';
import {
  StaleWhatsappRuntimeDatabaseFenceError,
  type WhatsappRuntimeDatabaseFence,
} from '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository';
import type {
  KafkaConsumerEffectLease,
  KafkaConsumerRunnerErrorDecision,
} from '@core/common/interfaces/KafkaConsumerRunnerOptions';
import { SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS } from '@core/common/functions/serviceApiWhatsappConsumerBindings';
import {
  acquireReboundAuxiliaryRuntimeLease,
  AuxiliaryRuntimeLeaseRaceError,
  isUnrecoverableAuxiliaryRuntimeEventError,
} from '@core/consumer/auxiliaryRuntimeRebind';

@singleton()
export class ProfileStatusExternalIdUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IUpdateProfileStatusExternalId> | null =
    null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(WorkerProfileStatusService)
    private readonly workerProfileStatusService: WorkerProfileStatusService,
    @inject(WhatsappRuntimeFenceService)
    private readonly runtimeFence: WhatsappRuntimeFenceService
  ) {}

  private parseMessage(
    value: Buffer | null
  ): IUpdateProfileStatusExternalId | null {
    if (!value) return null;

    try {
      const parsed = JSON.parse(
        value.toString()
      ) as IUpdateProfileStatusExternalId;

      if (
        'worker_profile_status_id' in parsed &&
        'external_id' in parsed &&
        typeof parsed.worker_profile_status_id === 'string' &&
        typeof parsed.external_id === 'string'
      ) {
        return parsed;
      }

      return null;
    } catch {
      return null;
    }
  }

  private async processUpdate(
    data: IUpdateProfileStatusExternalId,
    assertActive: () => void = () => undefined,
    runtimeLeaseOwned = false
  ): Promise<void> {
    assertActive();
    if (!runtimeLeaseOwned && !(await this.runtimeFence.isCurrent(data))) {
      return;
    }
    assertActive();
    await this.workerProfileStatusService.updateExternalId(
      data.worker_profile_status_id,
      data.external_id,
      this.runtimeDatabaseFence(data)
    );
  }

  private runtimeDatabaseFence(
    data: IUpdateProfileStatusExternalId
  ): WhatsappRuntimeDatabaseFence {
    const accountId = data.account_id?.trim();
    const workerId = data.worker_id?.trim();
    const sourceProvider = data.source_provider?.trim();
    const runtimeGeneration = Number(data.runtime_generation);
    const connectionEpoch = data.connection_epoch?.trim();
    if (
      !accountId ||
      !workerId ||
      !sourceProvider ||
      !connectionEpoch ||
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0
    ) {
      throw new StaleWhatsappRuntimeDatabaseFenceError();
    }

    return {
      account_id: accountId,
      worker_id: workerId,
      source_provider: sourceProvider,
      runtime_generation: runtimeGeneration,
      connection_epoch: connectionEpoch,
    };
  }

  private classifyConsumerError(
    error: unknown
  ): KafkaConsumerRunnerErrorDecision {
    return error instanceof StaleWhatsappRuntimeDatabaseFenceError ||
      isUnrecoverableAuxiliaryRuntimeEventError(error)
      ? 'terminal'
      : 'retryable';
  }

  private isImmutableIdentityValid(
    data: IUpdateProfileStatusExternalId
  ): boolean {
    const accountId = data.account_id?.trim();
    const workerId = data.worker_id?.trim();
    const profileStatusId = data.worker_profile_status_id?.trim();
    const externalId = data.external_id?.trim();
    const eventId = data.event_id?.trim();
    if (
      !accountId ||
      !workerId ||
      !profileStatusId ||
      !externalId ||
      !eventId
    ) {
      return false;
    }
    return (
      eventId ===
      [
        'profile-status-external-id',
        'v1',
        accountId,
        workerId,
        profileStatusId,
        externalId,
      ].join(':')
    );
  }

  private acquireRuntimeEffectLease(
    data: IUpdateProfileStatusExternalId
  ): Promise<KafkaConsumerEffectLease | null> {
    return acquireReboundAuxiliaryRuntimeLease(
      data,
      this.runtimeFence,
      (candidate) => this.isImmutableIdentityValid(candidate)
    );
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.updateProfileStatusExternalId();
    this.runner = new KafkaConsumerRunner<IUpdateProfileStatusExternalId>({
      kafka: this.kafka,
      topic,
      groupId:
        SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS.profileStatusExternalIdUpdate,
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) =>
        `${data.account_id?.trim() || 'unknown-account'}:${
          data.worker_id?.trim() || 'unknown-worker'
        }:${data.worker_profile_status_id}`,
      preserveEntityOrder: true,
      acquireEffectLease: (data) => this.acquireRuntimeEffectLease(data),
      classifyEffectLeaseRejection: async (data) =>
        (await this.runtimeFence.isCurrent(data)) ? 'retry' : 'terminal',
      handle: (data, context) =>
        this.processUpdate(data, context.assertActive, true),
      classifyError: (_data, _context, error) =>
        this.classifyConsumerError(error),
      shouldContinueRetryWithoutCommit: (_data, _context, error) =>
        error instanceof AuxiliaryRuntimeLeaseRaceError ||
        this.classifyConsumerError(error) === 'retryable',
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
  }
}
