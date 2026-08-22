import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import {
  IChatMessage,
  IMessageKey,
} from '@core/common/interfaces/IChatMessage';
import Redis from 'ioredis';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { remoteJid } from '@core/common/functions/remoteJid';
import { WAMessageKey } from '@whiskeysockets/baileys';
import { createChatCacheKeyChatId } from '@core/common/functions/createCacheKey';
import { MessageKeyUpdateScriptParams } from '@core/common/interfaces/IMessageKeyUpdateScript';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';
import { MessageStatusPendingService } from '@core/services/messageStatusPending.service';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { ChatService } from '@core/services/chat.service';
import {
  buildMessageUpdateEventId,
  buildMessageUpdateKafkaKey,
  ensureMessageUpdateIdentity,
} from '@core/common/functions/messageUpdateIdentity';
import { canonicalMessageStatusMessageId } from '@core/common/functions/messageStatusIdentity';
import { WhatsappRuntimeFenceService } from '@core/services/whatsappRuntimeFence.service';
import { runWithKafkaDispatchGuard } from '@core/common/functions/kafkaDispatchFenceContext';
import { SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS } from '@core/common/functions/serviceApiWhatsappConsumerBindings';
import {
  acquireReboundAuxiliaryRuntimeLease,
  type AuxiliaryRuntimeRecoveryReason,
  AuxiliaryRuntimeLeaseRaceError,
  type IAuxiliaryRuntimeLeaseRecovery,
  isUnrecoverableAuxiliaryRuntimeEventError,
  UnrecoverableAuxiliaryRuntimeEventError,
} from '@core/consumer/auxiliaryRuntimeRebind';
import type {
  KafkaConsumerEffectLease,
  KafkaConsumerRunnerErrorDecision,
} from '@core/common/interfaces/KafkaConsumerRunnerOptions';
import * as schema from '@core/models';
import { workerRuntime } from '@core/models';
import type { Transaction } from '@core/common/types/Transaction.type';
import {
  assertCurrentWhatsappRuntimeInTransaction,
  StaleWhatsappRuntimeDatabaseFenceError,
} from '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository';

const RUNTIME_TRANSITION_MAX_ATTEMPTS = 3;

interface IMessageUpdateRuntimeSnapshot {
  worker_id: string;
  source_provider: string;
  runtime_generation: number;
  connection_epoch: string;
  connection_sequence: number;
}

class MessageUpdateDatabaseRuntimeLease implements KafkaConsumerEffectLease {
  private readonly releaseSignal: Promise<void>;
  private resolveReleaseSignal: () => void = () => undefined;
  private transactionCompletion: Promise<void> | null = null;
  private releaseRequested = false;
  private lost = false;

  constructor() {
    this.releaseSignal = new Promise<void>((resolve) => {
      this.resolveReleaseSignal = resolve;
    });
  }

  bindTransaction(completion: Promise<void>): void {
    this.transactionCompletion = completion;
    void completion.then(
      () => {
        if (!this.releaseRequested) {
          this.lost = true;
        }
      },
      () => {
        this.lost = true;
      }
    );
  }

  waitForRelease(): Promise<void> {
    return this.releaseSignal;
  }

  assertOwned(): void {
    if (this.releaseRequested || this.lost) {
      throw new Error('message_update_database_runtime_lease_lost');
    }
  }

  async release(): Promise<void> {
    if (!this.releaseRequested) {
      this.releaseRequested = true;
      this.resolveReleaseSignal();
    }
    await this.transactionCompletion;
  }
}

type MessageKeyPatch = Pick<
  IMessageKey,
  'remote_jid' | 'id' | 'from_me' | 'participant' | 'is_view_once'
>;

class StaleMessageUpdateRuntimeError extends Error {
  constructor() {
    super('stale_message_update_runtime');
    this.name = 'StaleMessageUpdateRuntimeError';
  }
}

@singleton()
export class MessageUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IUpdateMessage> | null = null;
  private isRunning = false;
  private readonly runtimeFence: WhatsappRuntimeFenceService;

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(MessageStatusPendingService)
    private readonly messageStatusPendingService: MessageStatusPendingService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject('DatabaseRw')
    private readonly dbRw: NodePgDatabase<typeof schema> = undefined as never
  ) {
    this.runtimeFence = new WhatsappRuntimeFenceService(this.redis);
  }

  private cacheChatKey(accountId: string, chatId: string): string {
    return createChatCacheKeyChatId(accountId, chatId);
  }

  private parseMessage(value: Buffer | null): IUpdateMessage | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IUpdateMessage;
      if (!parsed) {
        return null;
      }
      ensureMessageUpdateIdentity(parsed);

      return parsed;
    } catch {
      return null;
    }
  }

  private buildMessageKeyPatch(data: IUpdateMessage): MessageKeyPatch {
    const jid = remoteJid(data.message?.key);
    const key = data.message?.key as WAMessageKey | undefined;

    const patch: MessageKeyPatch = {} as MessageKeyPatch;

    if (jid) {
      patch.remote_jid = jid;
    }

    if (data.message?.key?.id) {
      const normalizedId = this.normalizeMessageKeyId(data.message.key.id);
      if (normalizedId) {
        patch.id = normalizedId;
      }
    }

    if (data.message?.key?.fromMe !== undefined) {
      patch.from_me = data.message.key.fromMe;
    }

    if (data.message?.key?.participant !== undefined) {
      patch.participant = data.message.key.participant;
    }

    if (key?.isViewOnce !== undefined) {
      patch.is_view_once = key.isViewOnce;
    }

    return patch;
  }

  private normalizeMessageKeyId(id: string): string {
    const trimmed = id.trim();
    if (!trimmed) {
      return '';
    }

    const parsed = parseSerializedMessageId(trimmed);
    return parsed?.stanzaId ?? trimmed;
  }

  private buildMessageKeyUpdateScriptSource(): string {
    return `
      if (ctx._source == null) {
        ctx.op = 'noop';
        return;
      }
      
      if (ctx._source.message_key == null) {
        ctx._source.message_key = [:];
      }
      
      def changed = false;
      def patch = params.patch;
      
      if (patch.containsKey('remote_jid') && patch.remote_jid != null) {
        if (ctx._source.message_key.remote_jid == null) {
          ctx._source.message_key.remote_jid = patch.remote_jid;
          changed = true;
        }
      }
      
      if (patch.containsKey('id') && patch.id != null) {
        if (ctx._source.message_key.id == null) {
          ctx._source.message_key.id = patch.id;
          changed = true;
        }
      }
      
      if (patch.containsKey('from_me') && patch.from_me != null) {
        if (ctx._source.message_key.from_me == null) {
          ctx._source.message_key.from_me = patch.from_me;
          changed = true;
        }
      }
      
      if (patch.containsKey('participant') && patch.participant != null) {
        if (ctx._source.message_key.participant == null) {
          ctx._source.message_key.participant = patch.participant;
          changed = true;
        }
      }
      
      if (patch.containsKey('is_view_once') && patch.is_view_once != null) {
        if (ctx._source.message_key.is_view_once == null) {
          ctx._source.message_key.is_view_once = patch.is_view_once;
          changed = true;
        }
      }
      
      if (!changed) {
        ctx.op = 'noop';
      }
    `;
  }

  private buildMessageKeyUpdateScriptParams(
    patch: MessageKeyPatch
  ): MessageKeyUpdateScriptParams {
    return {
      patch: patch as Partial<IChatMessage['message_key']>,
    };
  }

  private async updateChatIfMissingRemoteJid(
    data: IUpdateMessage,
    assertActive: () => void | Promise<void>
  ): Promise<void> {
    const chatId = data.data?.chat_id;
    if (!chatId) {
      return;
    }

    const patch = this.buildMessageKeyPatch(data);
    const hasAnyValue = Boolean(
      patch.remote_jid ||
      patch.id ||
      patch.from_me !== undefined ||
      patch.participant ||
      patch.is_view_once !== undefined
    );

    if (!hasAnyValue) {
      return;
    }

    const scriptSource = this.buildMessageKeyUpdateScriptSource();
    const scriptParams = this.buildMessageKeyUpdateScriptParams(patch);

    await assertActive();
    await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.chat,
      chatId,
      {
        source: scriptSource,
        params: scriptParams,
      },
      {
        maxRetries: 5,
        assertActive,
      }
    );

    const cacheKey = this.cacheChatKey(data.data?.account?.id ?? '', chatId);

    await assertActive();
    await this.redis.del(cacheKey);
  }

  private async updateMessageIfMissingKey(
    data: IUpdateMessage,
    assertActive: () => void | Promise<void>
  ): Promise<void> {
    const messageId = data.data?.message_id;
    if (!messageId) {
      return;
    }

    const patch = this.buildMessageKeyPatch(data);
    const hasAnyValue = Boolean(
      patch.remote_jid ||
      patch.id ||
      patch.from_me !== undefined ||
      patch.participant ||
      patch.is_view_once !== undefined
    );

    if (!hasAnyValue) {
      return;
    }

    const intendedMessage: IChatMessage = {
      ...data.data,
      message_key: {
        ...(data.data.message_key ?? {}),
        ...patch,
      } as IChatMessage['message_key'],
    };
    await this.chatService.patchExistingMessageMissingFields(
      messageId,
      intendedMessage,
      {
        eventTypes: ['message.updated'],
        idempotencyKey: data.event_id
          ? `message-key-hydrated:${data.event_id}`
          : `message-key-hydrated:${messageId}:${patch.id ?? ''}:${patch.remote_jid ?? ''}:${patch.participant ?? ''}`,
        source: 'message_update',
        previousMessage: data.data,
        actor: { type: 'system' },
        changes: {
          message_key_hydrated: true,
          hydrated_fields: Object.entries(patch)
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([key]) => key),
        },
        assertActive,
      }
    );
  }

  private async publishPendingStatusForPatchedKey(
    data: IUpdateMessage,
    assertActive: () => void | Promise<void>
  ): Promise<void> {
    const accountId = data.data?.account?.id;
    const workerId = data.worker_id ?? data.data?.worker?.id;
    const internalMessageId = data.data?.message_id;
    const patch = this.buildMessageKeyPatch(data);
    const rawMessageKeyId = data.message?.key?.id?.trim();

    if (!accountId || !internalMessageId || !patch.id) {
      return;
    }

    const whatsAppMessageIds = Array.from(
      new Set(
        [patch.id, rawMessageKeyId]
          .map((messageId) => canonicalMessageStatusMessageId(messageId))
          .filter((messageId): messageId is string => Boolean(messageId))
      )
    );

    for (const whatsAppMessageId of whatsAppMessageIds) {
      await assertActive();
      await this.messageStatusPendingService.setInternalMessageIdAlias(
        accountId,
        whatsAppMessageId,
        internalMessageId,
        workerId
      );
    }
    for (const whatsAppMessageId of whatsAppMessageIds) {
      await assertActive();
      await this.messageStatusPendingService.wakePendingStatus(
        accountId,
        whatsAppMessageId,
        workerId
      );
    }
  }

  private async handleMessage(
    data: IUpdateMessage,
    assertActive: () => void | Promise<void> = () => undefined
  ): Promise<void> {
    await assertActive();
    await this.updateChatIfMissingRemoteJid(data, assertActive);
    await assertActive();
    await this.updateMessageIfMissingKey(data, assertActive);
    await assertActive();
    await this.publishPendingStatusForPatchedKey(data, assertActive);
  }

  private isImmutableIdentityValid(data: IUpdateMessage): boolean {
    const accountId = data.data?.account?.id?.trim();
    const eventWorkerId = data.worker_id?.trim();
    const payloadWorkerId = data.data?.worker?.id?.trim();
    const eventId = data.event_id?.trim();
    const expectedEventId = buildMessageUpdateEventId(data);
    return (
      Boolean(accountId) &&
      Boolean(eventWorkerId) &&
      Boolean(payloadWorkerId) &&
      eventWorkerId === payloadWorkerId &&
      Boolean(eventId) &&
      expectedEventId !== null &&
      eventId === expectedEventId
    );
  }

  private async viewDatabaseRuntimeSnapshot(
    tx: Transaction,
    workerId: string,
    sourceProvider: string
  ): Promise<IMessageUpdateRuntimeSnapshot> {
    const [runtime] = await tx
      .select({
        worker_id: workerRuntime.worker_id,
        source_provider: workerRuntime.source_provider,
        runtime_generation: workerRuntime.runtime_generation,
        connection_epoch: workerRuntime.connection_epoch,
        connection_sequence: workerRuntime.connection_sequence,
      })
      .from(workerRuntime)
      .where(eq(workerRuntime.worker_id, workerId))
      .limit(1)
      .execute();
    const runtimeProvider = runtime?.source_provider?.trim().toLowerCase();
    const runtimeEpoch = runtime?.connection_epoch?.trim();
    const runtimeGeneration = Number(runtime?.runtime_generation);
    const connectionSequence = Number(runtime?.connection_sequence);
    if (
      runtime?.worker_id !== workerId ||
      runtimeProvider !== sourceProvider ||
      !runtimeEpoch ||
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0 ||
      !Number.isSafeInteger(connectionSequence) ||
      connectionSequence <= 0
    ) {
      throw new StaleWhatsappRuntimeDatabaseFenceError();
    }

    return {
      worker_id: workerId,
      source_provider: runtimeProvider,
      runtime_generation: runtimeGeneration,
      connection_epoch: runtimeEpoch,
      connection_sequence: connectionSequence,
    };
  }

  private sameDatabaseRuntime(
    left: IMessageUpdateRuntimeSnapshot,
    right: IMessageUpdateRuntimeSnapshot
  ): boolean {
    return (
      left.worker_id === right.worker_id &&
      left.source_provider === right.source_provider &&
      left.runtime_generation === right.runtime_generation &&
      left.connection_epoch === right.connection_epoch &&
      left.connection_sequence === right.connection_sequence
    );
  }

  private async acquireDatabaseRuntimeEffectLease(
    data: IUpdateMessage,
    reason: AuxiliaryRuntimeRecoveryReason
  ): Promise<IAuxiliaryRuntimeLeaseRecovery> {
    const accountId = data.data?.account?.id?.trim();
    const workerId = data.worker_id?.trim();
    const sourceProvider = data.source_provider?.trim().toLowerCase();
    if (!accountId || !workerId || !sourceProvider) {
      throw new UnrecoverableAuxiliaryRuntimeEventError('invalid_identity');
    }
    if (!this.dbRw) {
      throw new Error('message_update_database_runtime_recovery_unavailable');
    }

    const lease = new MessageUpdateDatabaseRuntimeLease();
    let resolveRecovery: (
      recovery: IAuxiliaryRuntimeLeaseRecovery
    ) => void = () => undefined;
    let rejectRecovery: (error: unknown) => void = () => undefined;
    const recovery = new Promise<IAuxiliaryRuntimeLeaseRecovery>(
      (resolve, reject) => {
        resolveRecovery = resolve;
        rejectRecovery = reject;
      }
    );
    const transactionCompletion = this.dbRw.transaction(async (tx) => {
      try {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
        await tx.execute(
          sql`SET LOCAL idle_in_transaction_session_timeout = '30s'`
        );
        const snapshot = await this.viewDatabaseRuntimeSnapshot(
          tx,
          workerId,
          sourceProvider
        );
        await assertCurrentWhatsappRuntimeInTransaction(tx, {
          account_id: accountId,
          worker_id: snapshot.worker_id,
          source_provider: snapshot.source_provider,
          runtime_generation: snapshot.runtime_generation,
          connection_epoch: snapshot.connection_epoch,
        });
        const confirmed = await this.viewDatabaseRuntimeSnapshot(
          tx,
          workerId,
          sourceProvider
        );
        if (!this.sameDatabaseRuntime(snapshot, confirmed)) {
          throw new StaleWhatsappRuntimeDatabaseFenceError();
        }

        resolveRecovery({
          lease,
          worker_id: confirmed.worker_id,
          source_provider: confirmed.source_provider,
          runtime_generation: confirmed.runtime_generation,
          connection_epoch: confirmed.connection_epoch,
        });
        await lease.waitForRelease();
      } catch (error) {
        rejectRecovery(error);
        throw error;
      }
    });
    lease.bindTransaction(transactionCompletion);
    void transactionCompletion.catch(() => undefined);

    try {
      return await recovery;
    } catch (error) {
      if (error instanceof StaleWhatsappRuntimeDatabaseFenceError) {
        throw new UnrecoverableAuxiliaryRuntimeEventError(
          `durable_${reason}_stale`
        );
      }
      throw error;
    }
  }

  private recoverRuntimeEffectLease(
    data: IUpdateMessage,
    reason: AuxiliaryRuntimeRecoveryReason,
    attempt: number
  ): Promise<IAuxiliaryRuntimeLeaseRecovery | null> {
    if (
      (reason === 'runtime_activating' || reason === 'runtime_rotated') &&
      attempt < RUNTIME_TRANSITION_MAX_ATTEMPTS
    ) {
      return Promise.resolve(null);
    }
    return this.acquireDatabaseRuntimeEffectLease(data, reason);
  }

  private acquireRuntimeEffectLease(
    data: IUpdateMessage,
    attempt = 1
  ): Promise<KafkaConsumerEffectLease | null> {
    return acquireReboundAuxiliaryRuntimeLease(
      data,
      this.runtimeFence,
      (candidate) => this.isImmutableIdentityValid(candidate),
      (candidate) => candidate.data?.account?.id?.trim() || null,
      (candidate, reason) =>
        this.recoverRuntimeEffectLease(candidate, reason, attempt)
    );
  }

  private classifyConsumerError(
    error: unknown,
    attempt: number
  ): KafkaConsumerRunnerErrorDecision {
    if (
      error instanceof StaleMessageUpdateRuntimeError ||
      isUnrecoverableAuxiliaryRuntimeEventError(error)
    ) {
      return 'terminal';
    }
    if (
      error instanceof AuxiliaryRuntimeLeaseRaceError &&
      attempt >= RUNTIME_TRANSITION_MAX_ATTEMPTS
    ) {
      return 'terminal';
    }
    return 'retryable';
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.updateMessage();
    this.runner = new KafkaConsumerRunner<IUpdateMessage>({
      kafka: this.kafka,
      topic,
      groupId: SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS.messageUpdate,
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => buildMessageUpdateKafkaKey(data),
      preserveEntityOrder: true,
      acquireEffectLease: (data, context) =>
        this.acquireRuntimeEffectLease(data, context.attempt),
      classifyEffectLeaseRejection: async (data) =>
        (await this.runtimeFence.isCurrent(data)) ? 'retry' : 'terminal',
      maxRetries: RUNTIME_TRANSITION_MAX_ATTEMPTS,
      retryDelaysMs: [250, 1_000, 3_000],
      classifyError: (_data, context, error) =>
        this.classifyConsumerError(error, context.attempt),
      shouldContinueRetryWithoutCommit: (_data, context, error) =>
        this.classifyConsumerError(error, context.attempt) === 'retryable',
      handle: async (data, context) => {
        const assertMutationActive = async (): Promise<void> =>
          context.assertActive();

        try {
          context.assertActive();
          await runWithKafkaDispatchGuard(context.assertActive, () =>
            this.handleMessage(data, assertMutationActive)
          );
        } catch (error) {
          context.assertActive();
          if (error instanceof StaleMessageUpdateRuntimeError) {
            console.warn(
              '[MessageUpdateConsume] stale WhatsApp runtime event discarded',
              {
                topic,
                partition: context.partition,
                offset: context.offset,
                worker_id: data.worker_id ?? data.data?.worker?.id,
                source_provider: data.source_provider,
                runtime_generation: data.runtime_generation,
                connection_epoch: data.connection_epoch,
              }
            );
            throw error;
          }
          console.error('[MessageUpdateConsume] message update failed', {
            topic,
            partition: context.partition,
            offset: context.offset,
            error,
          });
          throw error;
        }
      },
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
