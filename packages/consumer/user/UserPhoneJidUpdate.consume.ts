import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUserPhoneJidUpdate } from '@core/common/interfaces/IUserPhoneJidUpdate';
import { UserService } from '@core/services/user.service';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { WhatsappRuntimeFenceService } from '@core/services/whatsappRuntimeFence.service';
import { SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS } from '@core/common/functions/serviceApiWhatsappConsumerBindings';
import {
  StaleWhatsappRuntimeDatabaseFenceError,
  type WhatsappRuntimeDatabaseFence,
} from '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository';
import { buildUserPhoneJidUpdateEventId } from '@core/common/functions/userPhoneJidUpdateIdentity';
import {
  acquireReboundAuxiliaryRuntimeLease,
  AuxiliaryRuntimeLeaseRaceError,
  isUnrecoverableAuxiliaryRuntimeEventError,
} from '@core/consumer/auxiliaryRuntimeRebind';
import type {
  KafkaConsumerEffectLease,
  KafkaConsumerRunnerErrorDecision,
} from '@core/common/interfaces/KafkaConsumerRunnerOptions';

class StaleUserPhoneJidRuntimeError extends Error {
  constructor() {
    super('user_phone_jid_runtime_fence_replaced');
    this.name = 'StaleUserPhoneJidRuntimeError';
  }
}

@singleton()
export class UserPhoneJidUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IUserPhoneJidUpdate> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(WhatsappRuntimeFenceService)
    private readonly runtimeFence: WhatsappRuntimeFenceService
  ) {}

  private parseMessage(value: Buffer | null): IUserPhoneJidUpdate | null {
    if (!value) return null;

    try {
      const parsed = JSON.parse(value.toString()) as IUserPhoneJidUpdate;

      if (
        'user_id' in parsed &&
        'phone_jid' in parsed &&
        typeof parsed.user_id === 'string' &&
        typeof parsed.phone_jid === 'string'
      ) {
        return parsed;
      }

      return null;
    } catch {
      return null;
    }
  }

  private async processUpdate(
    data: IUserPhoneJidUpdate,
    assertActive: () => void = () => undefined,
    runtimeLeaseOwned = false
  ): Promise<void> {
    const assertEventActive = async (): Promise<void> => {
      assertActive();
      if (!runtimeLeaseOwned && !(await this.runtimeFence.isCurrent(data))) {
        throw new StaleUserPhoneJidRuntimeError();
      }
      assertActive();
    };

    try {
      await assertEventActive();
      await this.userService.updateUserPhoneJid(
        data.user_id,
        data.phone_jid,
        this.runtimeDatabaseFence(data),
        assertEventActive
      );
      assertActive();
    } catch (error) {
      if (
        !(error instanceof StaleUserPhoneJidRuntimeError) &&
        !(error instanceof StaleWhatsappRuntimeDatabaseFenceError)
      ) {
        throw error;
      }

      console.warn(
        '[UserPhoneJidUpdateConsume] stale WhatsApp runtime event discarded',
        {
          event_id: data.event_id,
          worker_id: data.worker_id,
          source_provider: data.source_provider,
          runtime_generation: data.runtime_generation,
          connection_epoch: data.connection_epoch,
        }
      );
    }
  }

  private isImmutableIdentityValid(data: IUserPhoneJidUpdate): boolean {
    const expectedEventId = buildUserPhoneJidUpdateEventId(data);
    return (
      expectedEventId !== null &&
      data.event_id?.trim() === expectedEventId &&
      Boolean(data.account_id?.trim()) &&
      Boolean(data.worker_id?.trim()) &&
      Boolean(data.operation_id?.trim()) &&
      Boolean(data.user_id?.trim()) &&
      Boolean(data.phone_jid?.trim())
    );
  }

  private classifyConsumerError(
    error: unknown
  ): KafkaConsumerRunnerErrorDecision {
    return error instanceof StaleUserPhoneJidRuntimeError ||
      error instanceof StaleWhatsappRuntimeDatabaseFenceError ||
      isUnrecoverableAuxiliaryRuntimeEventError(error)
      ? 'terminal'
      : 'retryable';
  }

  private acquireRuntimeEffectLease(
    data: IUserPhoneJidUpdate
  ): Promise<KafkaConsumerEffectLease | null> {
    return acquireReboundAuxiliaryRuntimeLease(
      data,
      this.runtimeFence,
      (candidate) => this.isImmutableIdentityValid(candidate)
    );
  }

  private runtimeDatabaseFence(
    data: IUserPhoneJidUpdate
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

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.userPhoneJidUpdate();
    this.runner = new KafkaConsumerRunner<IUserPhoneJidUpdate>({
      kafka: this.kafka,
      topic,
      groupId: SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS.userPhoneJidUpdate,
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => data.user_id,
      preserveEntityOrder: true,
      acquireEffectLease: (data) => this.acquireRuntimeEffectLease(data),
      classifyEffectLeaseRejection: async (data) =>
        (await this.runtimeFence.isCurrent(data)) ? 'retry' : 'terminal',
      handle: async (data, context) => {
        try {
          await this.processUpdate(data, context.assertActive, true);
        } catch (error) {
          context.assertActive();
          console.error('Erro ao atualizar phone_jid:', error);
          throw error;
        }
      },
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
