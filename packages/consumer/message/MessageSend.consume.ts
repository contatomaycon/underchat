import { singleton, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { BaileysMessageTextService } from '@core/services/baileys/methods/messageText.service';
import { BaileysMessageMediaService } from '@core/services/baileys/methods/messageMedia.service';
import { BaileysMessageReactionsInteractionsService } from '@core/services/baileys/methods/messageReactionsInteractions.service';
import { BaileysMessageEditDeleteService } from '@core/services/baileys/methods/messageEditDelete.service';
import { BaileysMessageLocationContactService } from '@core/services/baileys/methods/messageLocationContact.service';
import { BaileysMessageStatusStoriesService } from '@core/services/baileys/methods/messageStatusStories.service';
import { BaileysProfileService } from '@core/services/baileys/methods/profile.service';
import { BaileysIncomingMessageService } from '@core/services/baileys/methods/incoming.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import {
  IChatMessage,
  IContactMessage,
} from '@core/common/interfaces/IChatMessage';
import { IProfileStatusMessage } from '@core/common/interfaces/IProfileStatusMessage';
import { IProfileStatusDeleteMessage } from '@core/common/interfaces/IProfileStatusDeleteMessage';
import { IProfileInfoMessage } from '@core/common/interfaces/IProfileInfoMessage';
import { IUpdateProfileStatusExternalId } from '@core/common/interfaces/IUpdateProfileStatusExternalId';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { IWorkerSendMessageDlq } from '@core/common/interfaces/IWorkerSendMessageDlq';
import { proto, WAMessage, WAUrlInfo } from '@whiskeysockets/baileys';
import { Buffer } from 'node:buffer';
import { KeyedSequencerService } from '@core/services/keyedSequencer.service';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { selectJidChat } from '@core/common/functions/selectJidChat';
import { convertWaveformBase64ToUint8Array } from '@core/common/functions/convertWaveform';
import { webcrypto } from 'node:crypto';
import { EWorkerProfileStatusType } from '@core/common/enums/EWorkerProfileStatusType';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { MessageKeyLookupService } from '@core/services/messageKeyLookup.service';
import { isMessageDeliveryConfirmationFailedError } from '@core/common/exceptions/MessageDeliveryConfirmationFailedError';
import { MessageStatusService } from '@core/services/messageStatus.service';
import { MessageSendIdempotencyService } from '@core/services/messageSendIdempotency.service';
import Redis from 'ioredis';
import { logger } from '@core/plugins/telemetry/logger';
import {
  recordException,
  incrementCounter,
  recordHistogram,
} from '@core/plugins/telemetry/observability';
import { resolveMessageSendIdentity } from '@core/common/functions/messageIdentity';

interface IPartitionCommitState {
  nextContiguousOffset: number | null;
  pendingOffsets: Set<number>;
  completedOffsets: Set<number>;
}

interface IQueuedEnvelope {
  topic: string;
  dlqTopic: string;
  partition: number;
  offset: number;
  payload: unknown;
  rawPayload: string | null;
  queueKey: string;
  chatId: string | null;
}

type ForwardFailReason =
  | 'missing_source_key'
  | 'source_key_incomplete'
  | 'source_not_found_cache_or_store'
  | 'native_forward_exception'
  | 'fallback_handler_unavailable';

@singleton()
export class MessageSendConsume {
  private readonly PROVIDER = 'baileys';
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private readonly CHAT_QUEUE_TIMEOUT_MS = 10 * 60 * 1000;
  private readonly MAX_PROCESS_ATTEMPTS = 5;
  private readonly MAX_REDRIVE_COUNT = 3;
  private readonly MAX_DLQ_PUBLISH_ATTEMPTS = 5;
  private readonly MAX_REDRIVE_PUBLISH_ATTEMPTS = 5;
  private readonly DLQ_DEDUPE_TTL_SECONDS = 86400;
  private readonly DLQ_DEDUPE_PREFIX = 'message-send:dlq-dedupe';
  private readonly RETRY_BASE_MS = 500;
  private readonly RETRY_MAX_MS = 8000;
  private readonly DLQ_PUBLISH_RETRY_DELAY_MS = 5000;
  private readonly REDRIVE_PUBLISH_RETRY_DELAY_MS = 1500;
  private readonly FORWARD_SOURCE_KEY_MAX_WAIT_MS = 4000;
  private readonly FORWARD_SOURCE_KEY_POLL_INTERVAL_MS = 300;
  private readonly SYSTEM_QUEUE_KEY = 'system';
  private readonly REDRIVE_COUNT_FIELD = '__baileys_redrive_count';
  private readonly lastMessageTypeByChatId: Map<string, EMessageType> =
    new Map();
  private readonly inFlightTasks = new Set<Promise<void>>();
  private readonly partitionCommitStates = new Map<
    number,
    IPartitionCommitState
  >();
  private readonly partitionCommitChains = new Map<number, Promise<void>>();
  private topic: string | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(BaileysMessageTextService)
    private readonly baileysMessageTextService: BaileysMessageTextService,
    @inject(BaileysMessageMediaService)
    private readonly baileysMessageMediaService: BaileysMessageMediaService,
    @inject(BaileysMessageReactionsInteractionsService)
    private readonly baileysMessageReactionsInteractionsService: BaileysMessageReactionsInteractionsService,
    @inject(BaileysMessageEditDeleteService)
    private readonly baileysMessageEditDeleteService: BaileysMessageEditDeleteService,
    @inject(BaileysMessageLocationContactService)
    private readonly baileysMessageLocationContactService: BaileysMessageLocationContactService,
    @inject(BaileysMessageStatusStoriesService)
    private readonly baileysMessageStatusStoriesService: BaileysMessageStatusStoriesService,
    @inject(BaileysProfileService)
    private readonly baileysProfileService: BaileysProfileService,
    @inject(BaileysIncomingMessageService)
    private readonly baileysIncomingMessageService: BaileysIncomingMessageService,
    @inject(MessageKeyLookupService)
    private readonly messageKeyLookupService: MessageKeyLookupService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(KeyedSequencerService)
    private readonly keyedSequencerService: KeyedSequencerService,
    @inject(MessageStatusService)
    private readonly messageStatusService: MessageStatusService,
    @inject(MessageSendIdempotencyService)
    private readonly messageSendIdempotencyService: MessageSendIdempotencyService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private logPipelineEvent(
    event: string,
    details: Record<string, unknown> = {},
    level: 'info' | 'warn' | 'error' = 'info'
  ): void {
    const payload = {
      module: 'worker_baileys',
      component: 'message_send_consume',
      type: 'message_send_pipeline',
      provider: this.PROVIDER,
      event,
      worker_id: baileysEnvironment.baileysWorkerId,
      account_id: baileysEnvironment.baileysAccountId,
      ...details,
    };

    if (level === 'error') {
      logger.error(payload, 'Baileys message send pipeline event');
      return;
    }

    if (level === 'warn') {
      logger.warn(payload, 'Baileys message send pipeline event');
      return;
    }

    logger.info(payload, 'Baileys message send pipeline event');
  }

  private queueTypeFromKey(queueKey: string): string {
    return queueKey.startsWith('chat:') ? 'chat' : 'system';
  }

  private attemptBucket(attempt: number): string {
    if (attempt <= 1) return '1';
    if (attempt <= 3) return '2-3';
    return '4+';
  }

  private baseMetricAttributes(
    envelope: IQueuedEnvelope,
    result: string,
    attempt: number,
    redriveCount: number
  ): Record<string, string | number> {
    return {
      provider: this.PROVIDER,
      result,
      queue_type: this.queueTypeFromKey(envelope.queueKey),
      attempt_bucket: this.attemptBucket(attempt),
      redrive_count: redriveCount,
    };
  }

  private extractMessageId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const value = (payload as { message_id?: unknown }).message_id;
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private getDlqDedupeKey(messageId: string): string {
    return `${this.DLQ_DEDUPE_PREFIX}:${this.PROVIDER}:${messageId}`;
  }

  private async acquireDlqDedupe(
    messageId: string
  ): Promise<'acquired' | 'duplicate' | 'error'> {
    try {
      const key = this.getDlqDedupeKey(messageId);
      const acquired = await this.redis.set(
        key,
        '1',
        'EX',
        this.DLQ_DEDUPE_TTL_SECONDS,
        'NX'
      );
      return acquired === 'OK' ? 'acquired' : 'duplicate';
    } catch (error) {
      this.logPipelineEvent(
        'dlq_dedupe_error',
        {
          message_id: messageId,
          error: this.errorMessage(error),
        },
        'error'
      );
      recordException(error, {
        messageSendPipeline: {
          provider: this.PROVIDER,
          event: 'dlq_dedupe_error',
          message_id: messageId,
        },
      });
      return 'error';
    }
  }

  private async isAlreadySent(messageId: string): Promise<boolean> {
    try {
      return await this.messageStatusService.isMessageAlreadySentByMessageId(
        messageId
      );
    } catch (error) {
      this.logPipelineEvent(
        'already_sent_check_error',
        {
          message_id: messageId,
          error: this.errorMessage(error),
        },
        'error'
      );
      recordException(error, {
        messageSendPipeline: {
          provider: this.PROVIDER,
          event: 'already_sent_check_error',
          message_id: messageId,
        },
      });
      return false;
    }
  }

  private async claimMessageSend(
    envelope: IQueuedEnvelope,
    payload: IChatMessage
  ): Promise<'acquired' | 'duplicate' | 'error' | 'missing_identity'> {
    const identity = resolveMessageSendIdentity(payload);
    if (!identity) {
      this.logPipelineEvent(
        'idempotency_identity_missing',
        {
          chat_id: envelope.chatId,
          queue_key: envelope.queueKey,
          partition: envelope.partition,
          offset: envelope.offset,
          message_id: this.extractMessageId(payload),
          result: 'idempotency_identity_missing',
        },
        'error'
      );
      return 'missing_identity';
    }

    payload.hash = identity.hash;

    const claimStatus = await this.messageSendIdempotencyService.claimSend(
      identity.accountId,
      identity.hash,
      {
        provider: this.PROVIDER,
        account_id: identity.accountId,
        chat_id: identity.chatId,
        message_id: identity.messageId,
        worker_id: baileysEnvironment.baileysWorkerId,
      }
    );

    if (claimStatus === 'duplicate') {
      this.logPipelineEvent('idempotency_duplicate_skipped', {
        chat_id: envelope.chatId,
        queue_key: envelope.queueKey,
        partition: envelope.partition,
        offset: envelope.offset,
        message_id: identity.messageId,
        message_hash: identity.hash,
        result: 'idempotency_duplicate_skipped',
      });
      incrementCounter(
        'message_send_idempotency_duplicate_skipped',
        1,
        this.baseMetricAttributes(
          envelope,
          'idempotency_duplicate_skipped',
          1,
          this.extractRedriveCount(envelope.payload)
        )
      );
      return 'duplicate';
    }

    if (claimStatus === 'error') {
      this.logPipelineEvent(
        'idempotency_claim_error',
        {
          chat_id: envelope.chatId,
          queue_key: envelope.queueKey,
          partition: envelope.partition,
          offset: envelope.offset,
          message_id: identity.messageId,
          message_hash: identity.hash,
          result: 'idempotency_claim_error',
        },
        'error'
      );
      return 'error';
    }

    this.logPipelineEvent('idempotency_claim_acquired', {
      chat_id: envelope.chatId,
      queue_key: envelope.queueKey,
      partition: envelope.partition,
      offset: envelope.offset,
      message_id: identity.messageId,
      message_hash: identity.hash,
      result: 'idempotency_claim_acquired',
    });

    return 'acquired';
  }

  private async markMessageAsFailedToSend(
    envelope: IQueuedEnvelope,
    messageId: string,
    reason: string,
    attempt: number,
    redriveCount: number,
    rootError?: unknown
  ): Promise<void> {
    try {
      await this.messageStatusService.markMessageAsNotSent(
        baileysEnvironment.baileysAccountId,
        messageId
      );
      this.logPipelineEvent('final_failed_marked', {
        chat_id: envelope.chatId,
        queue_key: envelope.queueKey,
        partition: envelope.partition,
        offset: envelope.offset,
        message_id: messageId,
        attempt,
        redrive_count: redriveCount,
        result: 'failed_marked',
        reason,
      });
      incrementCounter(
        'message_send_final_failed',
        1,
        this.baseMetricAttributes(
          envelope,
          'final_failed_marked',
          attempt,
          redriveCount
        )
      );
    } catch (error) {
      this.logPipelineEvent(
        'final_failed_mark_error',
        {
          chat_id: envelope.chatId,
          queue_key: envelope.queueKey,
          partition: envelope.partition,
          offset: envelope.offset,
          message_id: messageId,
          attempt,
          redrive_count: redriveCount,
          result: 'failed_mark_error',
          reason,
          error: this.errorMessage(error),
        },
        'error'
      );
      recordException(error, {
        messageSendPipeline: {
          provider: this.PROVIDER,
          event: 'final_failed_mark_error',
          reason,
          message_id: messageId,
          root_error: this.errorMessage(rootError),
        },
      });
    }
  }

  private createRedrivePayload(
    payload: unknown,
    redriveCount: number
  ): unknown {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    return {
      ...(payload as Record<string, unknown>),
      [this.REDRIVE_COUNT_FIELD]: redriveCount,
    };
  }

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaBaileysQueueService.workerSendMessage(
      baileysEnvironment.baileysWorkerId
    );
    const dlqTopic = this.kafkaBaileysQueueService.workerSendMessageDlq(
      baileysEnvironment.baileysWorkerId
    );

    await Promise.all([
      ensureKafkaTopic(
        this.kafka,
        topic,
        this.kafkaBaileysQueueService.getNumPartitions(),
        this.kafkaBaileysQueueService.getReplicationFactor()
      ),
      ensureKafkaTopic(
        this.kafka,
        dlqTopic,
        this.kafkaBaileysQueueService.getNumPartitions(),
        this.kafkaBaileysQueueService.getReplicationFactor()
      ),
    ]);

    this.topic = topic;

    this.consumer = createConsumer(
      this.kafka,
      `group-underchat-baileys-send-${baileysEnvironment.baileysWorkerId}`
    );

    this.consumer.on('data', (message) => {
      const task = this.handleMessageEvent(topic, dlqTopic, message)
        .catch((error) => {
          this.logPipelineEvent(
            'dispatch_error',
            {
              partition: message.partition,
              offset: message.offset,
              result: 'dispatch_error',
              error: this.errorMessage(error),
            },
            'error'
          );
          incrementCounter('message_send_error', 1, {
            provider: this.PROVIDER,
            result: 'dispatch_error',
            queue_type: 'unknown',
            attempt_bucket: '1',
            redrive_count: 0,
          });
          recordException(error, {
            messageSendPipeline: {
              provider: this.PROVIDER,
              event: 'dispatch_error',
              partition: message.partition,
              offset: message.offset,
            },
          });
        })
        .finally(() => {
          this.inFlightTasks.delete(task);
        });

      this.inFlightTasks.add(task);
    });

    this.consumer.on('event.error', (err) => {
      handleConsumerError(err, topic);
    });

    const consumer = this.consumer;
    if (!consumer) {
      throw new Error('Consumer not initialized');
    }

    connectConsumer(consumer, topic, () => {
      this.isRunning = true;
    });
  }

  public async close(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    try {
      this.isRunning = false;
      const consumer = this.consumer;
      const topic = this.topic;

      try {
        consumer.unsubscribe();
      } catch {}

      await Promise.allSettled(Array.from(this.inFlightTasks));
      await this.keyedSequencerService.drain();

      if (topic) {
        await this.flushAllPartitionCommits(topic);
      }

      await Promise.allSettled(Array.from(this.partitionCommitChains.values()));

      await new Promise<void>((resolve) => {
        consumer.disconnect(resolve);
      });
    } finally {
      this.consumer = null;
      this.topic = null;
      this.inFlightTasks.clear();
      this.partitionCommitStates.clear();
      this.partitionCommitChains.clear();
      this.lastMessageTypeByChatId.clear();
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }

  private extractRawMessage(value: Buffer | null): string | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    return raw;
  }

  private parseRawMessage(raw: string | null): unknown {
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private async handleMessageEvent(
    topic: string,
    dlqTopic: string,
    message: {
      value: Buffer | null;
      partition: number;
      offset: number;
    }
  ): Promise<void> {
    const rawPayload = this.extractRawMessage(message.value);
    const payload = this.parseRawMessage(rawPayload);
    const messageId = this.extractMessageId(payload);
    const redriveCount = this.extractRedriveCount(payload);

    this.registerPendingOffset(message.partition, message.offset);
    this.logPipelineEvent('consume_received', {
      partition: message.partition,
      offset: message.offset,
      message_id: messageId,
      redrive_count: redriveCount,
    });

    if (!payload) {
      this.logPipelineEvent('payload_invalid_skipped', {
        partition: message.partition,
        offset: message.offset,
        result: 'payload_invalid_skipped',
      });
      await this.completeOffset(topic, message.partition, message.offset);
      return;
    }

    const { queueKey, chatId } = this.resolveQueueContext(payload);
    const envelope: IQueuedEnvelope = {
      topic,
      dlqTopic,
      partition: message.partition,
      offset: message.offset,
      payload,
      rawPayload,
      queueKey,
      chatId,
    };

    let shouldCompleteOffset = false;

    try {
      await this.enqueueByQueueKey(queueKey, async () => {
        await this.processEnvelopeWithRetry(envelope);
      });
      this.logPipelineEvent('queue_enqueued', {
        chat_id: chatId,
        queue_key: queueKey,
        partition: message.partition,
        offset: message.offset,
        message_id: messageId,
        redrive_count: redriveCount,
      });
      shouldCompleteOffset = true;
    } catch (error) {
      this.logPipelineEvent(
        'enqueue_error',
        {
          chat_id: chatId,
          queue_key: queueKey,
          partition: message.partition,
          offset: message.offset,
          message_id: messageId,
          redrive_count: redriveCount,
          result: 'enqueue_error',
          error: this.errorMessage(error),
        },
        'error'
      );
      incrementCounter(
        'message_send_error',
        1,
        this.baseMetricAttributes(
          envelope,
          'enqueue_error',
          this.MAX_PROCESS_ATTEMPTS,
          redriveCount
        )
      );
      recordException(error, {
        messageSendPipeline: {
          provider: this.PROVIDER,
          event: 'enqueue_error',
          chat_id: chatId,
          queue_key: queueKey,
          partition: message.partition,
          offset: message.offset,
          message_id: messageId,
        },
      });

      await this.routeFailedMessage(
        envelope,
        error,
        this.MAX_PROCESS_ATTEMPTS,
        this.MAX_PROCESS_ATTEMPTS,
        'enqueue_error'
      );
      shouldCompleteOffset = true;
    } finally {
      if (shouldCompleteOffset) {
        await this.completeOffset(topic, message.partition, message.offset);
      }
    }
  }

  private isDeleteStatusMessage(
    payload: unknown
  ): payload is IProfileStatusDeleteMessage {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    return (
      'worker_profile_status_id' in payload &&
      'worker_id' in payload &&
      'external_id' in payload
    );
  }

  private isStatusMessage(payload: unknown): payload is IProfileStatusMessage {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    return (
      'worker_profile_status_id' in payload &&
      'worker_id' in payload &&
      !('external_id' in payload)
    );
  }

  private isProfileInfoMessage(
    payload: unknown
  ): payload is IProfileInfoMessage {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    return 'worker_id' in payload && 'account_id' in payload;
  }

  private isSendMessage(payload: unknown): payload is IChatMessage {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    return 'message_id' in payload && 'chat_id' in payload;
  }

  private resolveChatId(data: IChatMessage): string | null {
    const chatId = data.chat_id ?? data.message_key?.remote_jid ?? data.phone;

    if (!chatId) {
      return null;
    }

    return String(chatId);
  }

  private resolveQueueContext(payload: unknown): {
    queueKey: string;
    chatId: string | null;
  } {
    if (this.isSendMessage(payload)) {
      const chatId = this.resolveChatId(payload);
      if (chatId) {
        return {
          queueKey: `chat:${chatId}`,
          chatId,
        };
      }
    }

    return {
      queueKey: this.SYSTEM_QUEUE_KEY,
      chatId: null,
    };
  }

  private async enqueueByQueueKey(
    queueKey: string,
    task: () => Promise<void>
  ): Promise<void> {
    await this.keyedSequencerService.enqueue(queueKey, task, {
      timeoutMs: this.CHAT_QUEUE_TIMEOUT_MS,
    });
  }

  private async processEnvelopeWithRetry(
    envelope: IQueuedEnvelope
  ): Promise<void> {
    let lastError: unknown = null;
    const messageId = this.extractMessageId(envelope.payload);
    const redriveCount = this.extractRedriveCount(envelope.payload);
    const isSendPayload = this.isSendMessage(envelope.payload);
    const maxAttempts = isSendPayload ? 1 : this.MAX_PROCESS_ATTEMPTS;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startedAt = Date.now();
      try {
        await this.processPayload(envelope.payload, envelope);
        const durationMs = Date.now() - startedAt;
        this.logPipelineEvent('processed_success', {
          chat_id: envelope.chatId,
          queue_key: envelope.queueKey,
          partition: envelope.partition,
          offset: envelope.offset,
          message_id: messageId,
          redrive_count: redriveCount,
          attempt,
          result: 'success',
          duration_ms: durationMs,
        });
        incrementCounter(
          'message_send_success',
          1,
          this.baseMetricAttributes(envelope, 'success', attempt, redriveCount)
        );
        recordHistogram(
          'message_send_duration_ms',
          durationMs,
          this.baseMetricAttributes(envelope, 'success', attempt, redriveCount)
        );
        return;
      } catch (error) {
        lastError = error;
        if (isMessageDeliveryConfirmationFailedError(error)) {
          this.logPipelineEvent(
            'delivery_unconfirmed',
            {
              chat_id: envelope.chatId,
              queue_key: envelope.queueKey,
              partition: envelope.partition,
              offset: envelope.offset,
              message_id: messageId,
              redrive_count: redriveCount,
              attempt,
              result: 'delivery_unconfirmed',
              error: this.errorMessage(error),
            },
            'warn'
          );
          incrementCounter(
            'message_send_delivery_unconfirmed',
            1,
            this.baseMetricAttributes(
              envelope,
              'delivery_unconfirmed',
              attempt,
              redriveCount
            )
          );

          await this.routeFailedMessage(
            envelope,
            error,
            error.maxAttempts ?? attempt,
            attempt,
            'delivery_unconfirmed'
          );
          return;
        }

        if (isSendPayload) {
          this.logPipelineEvent(
            'at_most_once_terminal_failed',
            {
              chat_id: envelope.chatId,
              queue_key: envelope.queueKey,
              partition: envelope.partition,
              offset: envelope.offset,
              message_id: messageId,
              redrive_count: redriveCount,
              attempt,
              result: 'at_most_once_terminal_failed',
              error: this.errorMessage(error),
            },
            'warn'
          );
          incrementCounter(
            'message_send_error',
            1,
            this.baseMetricAttributes(
              envelope,
              'at_most_once_terminal_failed',
              attempt,
              redriveCount
            )
          );
          await this.routeFailedMessage(
            envelope,
            error,
            attempt,
            attempt,
            'processing_failed'
          );
          return;
        }

        const isLastAttempt = attempt === maxAttempts;

        this.logPipelineEvent(
          isLastAttempt ? 'processing_failed' : 'retry_scheduled',
          {
            chat_id: envelope.chatId,
            queue_key: envelope.queueKey,
            partition: envelope.partition,
            offset: envelope.offset,
            message_id: messageId,
            redrive_count: redriveCount,
            attempt,
            result: isLastAttempt ? 'failed' : 'retrying',
            error: this.errorMessage(error),
          },
          isLastAttempt ? 'warn' : 'info'
        );

        if (!isLastAttempt) {
          incrementCounter(
            'message_send_retry',
            1,
            this.baseMetricAttributes(
              envelope,
              'retrying',
              attempt,
              redriveCount
            )
          );
          await this.delay(this.calculateRetryDelayMs(attempt));
        }
      }
    }

    await this.routeFailedMessage(
      envelope,
      lastError,
      maxAttempts,
      maxAttempts,
      'processing_failed'
    );
  }

  private async processPayload(
    payload: unknown,
    envelope: IQueuedEnvelope
  ): Promise<void> {
    if (this.isDeleteStatusMessage(payload)) {
      await this.processDeleteStatus(payload);
      return;
    }

    if (this.isStatusMessage(payload)) {
      await this.processProfileStatus(payload);
      return;
    }

    if (this.isProfileInfoMessage(payload)) {
      await this.processProfileInfo(payload);
      return;
    }

    if (this.isSendMessage(payload)) {
      const chatId = this.resolveChatId(payload);
      if (!chatId) {
        console.warn(
          '[MessageSend] Send payload without chatId. Message skipped.'
        );
        return;
      }

      const claimStatus = await this.claimMessageSend(envelope, payload);
      if (claimStatus === 'duplicate') {
        return;
      }

      if (claimStatus !== 'acquired') {
        throw new Error(`message_send_idempotency_${claimStatus}`);
      }

      await this.processMessage(payload);
      return;
    }

    console.warn('[MessageSend] Unsupported payload type. Message skipped.');
  }

  private getPartitionCommitState(partition: number): IPartitionCommitState {
    const existingState = this.partitionCommitStates.get(partition);
    if (existingState) {
      return existingState;
    }

    const newState: IPartitionCommitState = {
      nextContiguousOffset: null,
      pendingOffsets: new Set<number>(),
      completedOffsets: new Set<number>(),
    };

    this.partitionCommitStates.set(partition, newState);
    return newState;
  }

  private registerPendingOffset(partition: number, offset: number): void {
    const state = this.getPartitionCommitState(partition);
    state.pendingOffsets.add(offset);

    if (
      state.nextContiguousOffset === null ||
      offset < state.nextContiguousOffset
    ) {
      state.nextContiguousOffset = offset;
    }
  }

  private async completeOffset(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await this.enqueuePartitionCommitOperation(partition, async () => {
      const state = this.partitionCommitStates.get(partition);
      if (!state || !state.pendingOffsets.has(offset)) {
        return;
      }

      state.completedOffsets.add(offset);
      await this.flushContiguousOffsets(topic, partition, state);
    });
  }

  private enqueuePartitionCommitOperation(
    partition: number,
    operation: () => Promise<void>
  ): Promise<void> {
    const previousChain =
      this.partitionCommitChains.get(partition) ?? Promise.resolve();

    const nextChain = previousChain
      .catch(() => {})
      .then(operation)
      .catch((error) => {
        this.logPipelineEvent(
          'commit_coordination_error',
          {
            partition,
            result: 'commit_coordination_error',
            error: this.errorMessage(error),
          },
          'error'
        );
        incrementCounter('message_send_error', 1, {
          provider: this.PROVIDER,
          result: 'commit_coordination_error',
          queue_type: 'unknown',
          attempt_bucket: '1',
          redrive_count: 0,
        });
        recordException(error, {
          messageSendPipeline: {
            provider: this.PROVIDER,
            event: 'commit_coordination_error',
            partition,
          },
        });
      });

    this.partitionCommitChains.set(partition, nextChain);

    return nextChain.finally(() => {
      if (this.partitionCommitChains.get(partition) === nextChain) {
        this.partitionCommitChains.delete(partition);
      }
    });
  }

  private async flushContiguousOffsets(
    topic: string,
    partition: number,
    state: IPartitionCommitState
  ): Promise<void> {
    if (state.nextContiguousOffset === null) {
      return;
    }

    const startOffset = state.nextContiguousOffset;
    let endOffset = startOffset;

    while (state.completedOffsets.has(endOffset)) {
      endOffset += 1;
    }

    const commitUpTo = endOffset - 1;
    if (commitUpTo < startOffset) {
      return;
    }

    await this.commitNext(topic, partition, commitUpTo);

    for (
      let currentOffset = startOffset;
      currentOffset <= commitUpTo;
      currentOffset += 1
    ) {
      state.completedOffsets.delete(currentOffset);
      state.pendingOffsets.delete(currentOffset);
    }

    state.nextContiguousOffset = commitUpTo + 1;

    if (state.pendingOffsets.size === 0 && state.completedOffsets.size === 0) {
      state.nextContiguousOffset = null;
      this.partitionCommitStates.delete(partition);
    }
  }

  private async flushAllPartitionCommits(topic: string): Promise<void> {
    const partitions = Array.from(this.partitionCommitStates.keys());

    for (const partition of partitions) {
      await this.enqueuePartitionCommitOperation(partition, async () => {
        const state = this.partitionCommitStates.get(partition);
        if (!state) {
          return;
        }

        await this.flushContiguousOffsets(topic, partition, state);
      });
    }
  }

  private calculateRetryDelayMs(attempt: number): number {
    const exponentialDelay = Math.min(
      this.RETRY_MAX_MS,
      this.RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1)
    );
    const jitter = Math.floor(exponentialDelay * 0.2 * this.randomFraction());
    return exponentialDelay + jitter;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private randomFraction(): number {
    const array = new Uint32Array(1);
    webcrypto.getRandomValues(array);
    return array[0] / (0xffffffff + 1);
  }

  private async routeFailedMessage(
    envelope: IQueuedEnvelope,
    error: unknown,
    attempts: number,
    attempt: number,
    failureEvent: 'delivery_unconfirmed' | 'processing_failed' | 'enqueue_error'
  ): Promise<void> {
    const isSendPayload = this.isSendMessage(envelope.payload);
    const messageId = this.extractMessageId(envelope.payload);
    const redriveCount = this.extractRedriveCount(envelope.payload);

    if (failureEvent === 'processing_failed') {
      incrementCounter(
        'message_send_error',
        1,
        this.baseMetricAttributes(
          envelope,
          'processing_failed',
          attempt,
          redriveCount
        )
      );
    }

    if (!messageId) {
      this.logPipelineEvent(
        'missing_message_id_skipped',
        {
          chat_id: envelope.chatId,
          queue_key: envelope.queueKey,
          partition: envelope.partition,
          offset: envelope.offset,
          attempt,
          redrive_count: redriveCount,
          result: 'missing_message_id',
          failure_event: failureEvent,
          error: this.errorMessage(error),
        },
        'warn'
      );
      incrementCounter(
        'message_send_error',
        1,
        this.baseMetricAttributes(envelope, 'missing_message_id', attempt, 0)
      );
      return;
    }

    const alreadySent = await this.isAlreadySent(messageId);
    if (alreadySent) {
      this.logPipelineEvent('already_sent_skipped', {
        chat_id: envelope.chatId,
        queue_key: envelope.queueKey,
        partition: envelope.partition,
        offset: envelope.offset,
        message_id: messageId,
        attempt,
        redrive_count: redriveCount,
        result: 'already_sent_skipped',
      });
      incrementCounter(
        'message_send_already_sent_skipped',
        1,
        this.baseMetricAttributes(
          envelope,
          'already_sent_skipped',
          attempt,
          redriveCount
        )
      );
      return;
    }

    if (isSendPayload) {
      const terminalReason = `${failureEvent}_terminal`;
      this.logPipelineEvent(
        'at_most_once_terminal_mark',
        {
          chat_id: envelope.chatId,
          queue_key: envelope.queueKey,
          partition: envelope.partition,
          offset: envelope.offset,
          message_id: messageId,
          attempt,
          redrive_count: redriveCount,
          result: 'at_most_once_terminal_mark',
          reason: terminalReason,
          error: this.errorMessage(error),
        },
        'warn'
      );
      await this.markMessageAsFailedToSend(
        envelope,
        messageId,
        terminalReason,
        attempt,
        redriveCount,
        error
      );
      return;
    }

    if (redriveCount >= this.MAX_REDRIVE_COUNT) {
      this.logPipelineEvent(
        'redrive_limit_reached',
        {
          chat_id: envelope.chatId,
          queue_key: envelope.queueKey,
          partition: envelope.partition,
          offset: envelope.offset,
          message_id: messageId,
          attempt,
          redrive_count: redriveCount,
          result: 'redrive_limit_reached',
          error: this.errorMessage(error),
        },
        'warn'
      );
      await this.markMessageAsFailedToSend(
        envelope,
        messageId,
        'redrive_limit_reached',
        attempt,
        redriveCount,
        error
      );
      return;
    }

    if (redriveCount === 0) {
      const dedupeStatus = await this.acquireDlqDedupe(messageId);
      if (dedupeStatus === 'duplicate') {
        this.logPipelineEvent('dlq_duplicate_skipped', {
          chat_id: envelope.chatId,
          queue_key: envelope.queueKey,
          partition: envelope.partition,
          offset: envelope.offset,
          message_id: messageId,
          attempt,
          redrive_count: redriveCount,
          result: 'dlq_duplicate_skipped',
        });
        incrementCounter(
          'message_send_dlq_duplicate_skipped',
          1,
          this.baseMetricAttributes(
            envelope,
            'dlq_duplicate_skipped',
            attempt,
            redriveCount
          )
        );
        return;
      }

      if (dedupeStatus === 'error') {
        await this.markMessageAsFailedToSend(
          envelope,
          messageId,
          'dlq_dedupe_error',
          attempt,
          redriveCount,
          error
        );
        return;
      }

      const published = await this.publishDlqWithRetry(
        envelope,
        error,
        attempts,
        messageId,
        redriveCount,
        attempt
      );

      if (!published) {
        await this.markMessageAsFailedToSend(
          envelope,
          messageId,
          'dlq_publish_failed',
          attempt,
          redriveCount,
          error
        );
      }
      return;
    }

    const nextRedriveCount = redriveCount + 1;
    const requeued = await this.redriveToPrimaryWithRetry(
      envelope,
      messageId,
      attempt,
      nextRedriveCount
    );

    if (!requeued) {
      await this.markMessageAsFailedToSend(
        envelope,
        messageId,
        'redrive_publish_failed',
        attempt,
        redriveCount,
        error
      );
    }
  }

  private async redriveToPrimaryWithRetry(
    envelope: IQueuedEnvelope,
    messageId: string,
    attempt: number,
    nextRedriveCount: number
  ): Promise<boolean> {
    const payload = this.createRedrivePayload(
      envelope.payload,
      nextRedriveCount
    );
    const key = envelope.chatId ?? `${envelope.partition}:${envelope.offset}`;
    const startedAt = Date.now();

    for (
      let redriveAttempt = 1;
      redriveAttempt <= this.MAX_REDRIVE_PUBLISH_ATTEMPTS;
      redriveAttempt++
    ) {
      try {
        await this.streamProducerService.send(envelope.topic, payload, key);
        const durationMs = Date.now() - startedAt;
        this.logPipelineEvent('redrive_requeued', {
          chat_id: envelope.chatId,
          queue_key: envelope.queueKey,
          partition: envelope.partition,
          offset: envelope.offset,
          message_id: messageId,
          attempt,
          redrive_count: nextRedriveCount,
          result: 'redrive_requeued',
          duration_ms: durationMs,
        });
        incrementCounter(
          'message_send_redrive_requeued',
          1,
          this.baseMetricAttributes(
            envelope,
            'redrive_requeued',
            attempt,
            nextRedriveCount
          )
        );
        recordHistogram(
          'message_send_redrive_duration_ms',
          durationMs,
          this.baseMetricAttributes(
            envelope,
            'redrive_requeued',
            attempt,
            nextRedriveCount
          )
        );
        return true;
      } catch (error) {
        if (redriveAttempt >= this.MAX_REDRIVE_PUBLISH_ATTEMPTS) {
          this.logPipelineEvent(
            'redrive_publish_error',
            {
              chat_id: envelope.chatId,
              queue_key: envelope.queueKey,
              partition: envelope.partition,
              offset: envelope.offset,
              message_id: messageId,
              attempt,
              redrive_count: nextRedriveCount,
              redrive_attempt: redriveAttempt,
              result: 'redrive_publish_error',
              error: this.errorMessage(error),
            },
            'error'
          );
          recordException(error, {
            messageSendPipeline: {
              provider: this.PROVIDER,
              event: 'redrive_publish_error',
              message_id: messageId,
              attempt,
              redrive_count: nextRedriveCount,
            },
          });
          return false;
        }

        this.logPipelineEvent(
          'redrive_publish_retry',
          {
            chat_id: envelope.chatId,
            queue_key: envelope.queueKey,
            partition: envelope.partition,
            offset: envelope.offset,
            message_id: messageId,
            attempt,
            redrive_count: nextRedriveCount,
            redrive_attempt: redriveAttempt,
            result: 'redrive_publish_retry',
            error: this.errorMessage(error),
          },
          'warn'
        );
        await this.delay(this.REDRIVE_PUBLISH_RETRY_DELAY_MS);
      }
    }

    return false;
  }

  private async publishDlqWithRetry(
    envelope: IQueuedEnvelope,
    error: unknown,
    attempts: number,
    messageId: string,
    redriveCount: number,
    attempt: number
  ): Promise<boolean> {
    const startedAt = Date.now();
    const dlqPayload: IWorkerSendMessageDlq = {
      worker_id: baileysEnvironment.baileysWorkerId,
      topic: envelope.topic,
      partition: envelope.partition,
      offset: envelope.offset,
      chat_id: envelope.chatId,
      message_id: messageId,
      queue_key: envelope.queueKey,
      attempts,
      redrive_count: redriveCount,
      error: this.errorMessage(error),
      payload: envelope.payload,
      raw_payload: envelope.rawPayload,
      failed_at: new Date().toISOString(),
    };

    for (
      let dlqAttempt = 1;
      dlqAttempt <= this.MAX_DLQ_PUBLISH_ATTEMPTS;
      dlqAttempt++
    ) {
      try {
        await this.streamProducerService.send(
          envelope.dlqTopic,
          dlqPayload,
          envelope.chatId ?? `${envelope.partition}:${envelope.offset}`
        );

        const durationMs = Date.now() - startedAt;
        this.logPipelineEvent('dlq_published', {
          chat_id: envelope.chatId,
          queue_key: envelope.queueKey,
          partition: envelope.partition,
          offset: envelope.offset,
          message_id: messageId,
          attempt,
          redrive_count: redriveCount,
          dlq_attempt: dlqAttempt,
          result: 'dlq_published',
          duration_ms: durationMs,
          error: this.errorMessage(error),
        });
        incrementCounter(
          'message_send_dlq_published',
          1,
          this.baseMetricAttributes(
            envelope,
            'dlq_published',
            attempt,
            redriveCount
          )
        );
        recordHistogram(
          'message_send_dlq_publish_duration_ms',
          durationMs,
          this.baseMetricAttributes(
            envelope,
            'dlq_published',
            attempt,
            redriveCount
          )
        );
        return true;
      } catch (publishError) {
        if (dlqAttempt >= this.MAX_DLQ_PUBLISH_ATTEMPTS) {
          this.logPipelineEvent(
            'dlq_publish_error',
            {
              chat_id: envelope.chatId,
              queue_key: envelope.queueKey,
              partition: envelope.partition,
              offset: envelope.offset,
              message_id: messageId,
              attempt,
              redrive_count: redriveCount,
              dlq_attempt: dlqAttempt,
              result: 'dlq_publish_error',
              error: this.errorMessage(publishError),
            },
            'error'
          );
          recordException(publishError, {
            messageSendPipeline: {
              provider: this.PROVIDER,
              event: 'dlq_publish_error',
              message_id: messageId,
              attempt,
              redrive_count: redriveCount,
            },
          });
          return false;
        }

        this.logPipelineEvent(
          'dlq_publish_retry',
          {
            chat_id: envelope.chatId,
            queue_key: envelope.queueKey,
            partition: envelope.partition,
            offset: envelope.offset,
            message_id: messageId,
            attempt,
            redrive_count: redriveCount,
            dlq_attempt: dlqAttempt,
            result: 'dlq_publish_retry',
            error: this.errorMessage(publishError),
          },
          'warn'
        );
        await this.delay(this.DLQ_PUBLISH_RETRY_DELAY_MS);
      }
    }

    return false;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private extractRedriveCount(payload: unknown): number {
    if (!payload || typeof payload !== 'object') {
      return 0;
    }

    if (!(this.REDRIVE_COUNT_FIELD in payload)) {
      return 0;
    }

    const value = (payload as Record<string, unknown>)[
      this.REDRIVE_COUNT_FIELD
    ];

    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return 0;
    }

    return Math.floor(value);
  }

  private getRandomDelay(): number {
    const array = new Uint32Array(1);
    webcrypto.getRandomValues(array);
    const randomValue = array[0] / (0xffffffff + 1);
    return Math.floor(randomValue * (2000 - 500 + 1)) + 500;
  }

  private async applyDelayIfNeeded(
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined
  ): Promise<void> {
    if (currentType && currentType === lastType) {
      const delay = this.getRandomDelay();
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  private async processMessageWithDelay(
    jid: string,
    chatId: string,
    data: IChatMessage,
    currentType: EMessageType,
    lastType: EMessageType | undefined,
    processor: (jid: string, data: IChatMessage) => Promise<void>
  ): Promise<void> {
    await this.applyDelayIfNeeded(currentType, lastType);
    await processor(jid, data);
    this.lastMessageTypeByChatId.set(chatId, currentType);
  }

  private async processMediaMessage(
    jid: string,
    chatId: string,
    data: IChatMessage,
    type: EMessageType,
    lastType: EMessageType | undefined,
    processor: (jid: string, data: IChatMessage) => Promise<void>
  ): Promise<void> {
    await this.processMessageWithDelay(
      jid,
      chatId,
      data,
      type,
      lastType,
      processor
    );
  }

  private async processTextMessage(
    jid: string,
    chatId: string,
    data: IChatMessage,
    hasQuoted: boolean
  ): Promise<void> {
    if (hasQuoted && data.content?.quoted) {
      await this.processTextQuoted(jid, data);
      this.lastMessageTypeByChatId.set(chatId, EMessageType.text);
      return;
    }

    await this.processText(jid, data);
    this.lastMessageTypeByChatId.set(chatId, EMessageType.text);
  }

  private async processActionMessage(
    jid: string,
    chatId: string,
    data: IChatMessage,
    type: EMessageType,
    processor: (jid: string, data: IChatMessage) => Promise<void>
  ): Promise<void> {
    await processor(jid, data);
    this.lastMessageTypeByChatId.set(chatId, type);
  }

  private createMediaHandler(
    jid: string,
    chatId: string,
    data: IChatMessage,
    type: EMessageType,
    lastType: EMessageType | undefined,
    processor: (j: string, d: IChatMessage) => Promise<void>
  ): () => Promise<void> {
    return () =>
      this.processMediaMessage(jid, chatId, data, type, lastType, processor);
  }

  private createActionHandler(
    jid: string,
    chatId: string,
    data: IChatMessage,
    type: EMessageType,
    processor: (j: string, d: IChatMessage) => Promise<void>
  ): () => Promise<void> {
    return () => this.processActionMessage(jid, chatId, data, type, processor);
  }

  private createMediaTypeHandler(
    url: string | undefined,
    jid: string,
    chatId: string,
    data: IChatMessage,
    type: EMessageType,
    lastType: EMessageType | undefined,
    processor: (j: string, d: IChatMessage) => Promise<void>
  ): (() => Promise<void>) | null {
    if (!url) return null;
    return this.createMediaHandler(
      jid,
      chatId,
      data,
      type,
      lastType,
      processor
    );
  }

  private createActionTypeHandler(
    condition: boolean | undefined,
    jid: string,
    chatId: string,
    data: IChatMessage,
    type: EMessageType,
    processor: (j: string, d: IChatMessage) => Promise<void>
  ): (() => Promise<void>) | null {
    if (!condition) return null;
    return this.createActionHandler(jid, chatId, data, type, processor);
  }

  private createTextMessageHandler(
    message: string | undefined,
    jid: string,
    chatId: string,
    data: IChatMessage,
    hasQuoted: boolean
  ): (() => Promise<void>) | null {
    if (!message) return null;
    return () => this.processTextMessage(jid, chatId, data, hasQuoted);
  }

  private selectMessageHandler(
    currentType: EMessageType | undefined,
    jid: string,
    chatId: string,
    data: IChatMessage,
    lastType: EMessageType | undefined,
    hasQuoted: boolean
  ): (() => Promise<void>) | null {
    if (!currentType) {
      return null;
    }

    const handlers: Partial<
      Record<EMessageType, (() => Promise<void>) | null>
    > = {
      [EMessageType.image]: this.createMediaTypeHandler(
        data.content?.image?.url ?? undefined,
        jid,
        chatId,
        data,
        EMessageType.image,
        lastType,
        (j, d) => this.processImage(j, d)
      ),
      [EMessageType.document]: this.createMediaTypeHandler(
        data.content?.document?.url ?? undefined,
        jid,
        chatId,
        data,
        EMessageType.document,
        lastType,
        (j, d) => this.processDocument(j, d)
      ),
      [EMessageType.audio]: this.createMediaTypeHandler(
        data.content?.audio?.url ?? undefined,
        jid,
        chatId,
        data,
        EMessageType.audio,
        lastType,
        (j, d) => this.processAudio(j, d)
      ),
      [EMessageType.video]: this.createMediaTypeHandler(
        data.content?.video?.url ?? undefined,
        jid,
        chatId,
        data,
        EMessageType.video,
        lastType,
        (j, d) => this.processVideo(j, d)
      ),
      [EMessageType.video_note]: this.createMediaTypeHandler(
        data.content?.video?.url ?? undefined,
        jid,
        chatId,
        data,
        EMessageType.video_note,
        lastType,
        (j, d) => this.processVideo(j, d)
      ),
      [EMessageType.sticker]: this.createMediaTypeHandler(
        data.content?.sticker?.url ?? undefined,
        jid,
        chatId,
        data,
        EMessageType.sticker,
        lastType,
        (j, d) => this.processSticker(j, d)
      ),
      [EMessageType.location]: this.createActionTypeHandler(
        !!data.content?.location,
        jid,
        chatId,
        data,
        EMessageType.location,
        (j, d) => this.processLocation(j, d)
      ),
      [EMessageType.text]: this.createTextMessageHandler(
        data.content?.message ?? undefined,
        jid,
        chatId,
        data,
        hasQuoted
      ),
      [EMessageType.system]: this.createTextMessageHandler(
        data.content?.message ?? undefined,
        jid,
        chatId,
        data,
        hasQuoted
      ),
      [EMessageType.contact_card]: this.createActionTypeHandler(
        !!data.content?.contact,
        jid,
        chatId,
        data,
        EMessageType.contact_card,
        (j, d) => this.processContact(j, d)
      ),
      [EMessageType.contacts]: this.createActionTypeHandler(
        !!data.content?.contacts?.length,
        jid,
        chatId,
        data,
        EMessageType.contacts,
        (j, d) => this.processContacts(j, d)
      ),
      [EMessageType.delete_message]: this.createActionTypeHandler(
        !!data.message_key?.id,
        jid,
        chatId,
        data,
        EMessageType.delete_message,
        (j, d) => this.processDelete(j, d)
      ),
      [EMessageType.react]: this.createActionTypeHandler(
        !!data.message_key?.id,
        jid,
        chatId,
        data,
        EMessageType.react,
        (j, d) => this.processReact(j, d)
      ),
    };

    return handlers[currentType] ?? null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private hasForwardSourceKeyId(data: IChatMessage): boolean {
    return !!data.content?.forward?.source_message_key?.id?.trim();
  }

  private hasForwardSourceRemote(data: IChatMessage): boolean {
    const sourceKey = data.content?.forward?.source_message_key;
    if (sourceKey?.remote_jid?.trim() || sourceKey?.remote_jid_alt?.trim()) {
      return true;
    }

    const parsed = parseSerializedMessageId(sourceKey?.id ?? null);
    return !!parsed?.remoteJid?.trim();
  }

  private hasUsableForwardSourceKey(data: IChatMessage): boolean {
    return (
      this.hasForwardSourceKeyId(data) && this.hasForwardSourceRemote(data)
    );
  }

  private resolveMissingSourceReason(data: IChatMessage): ForwardFailReason {
    if (!this.hasForwardSourceKeyId(data)) {
      return 'missing_source_key';
    }

    return 'source_key_incomplete';
  }

  private mergeForwardSourceKey(
    data: IChatMessage,
    sourceKey: NonNullable<IChatMessage['message_key']>
  ): void {
    if (!data.content?.forward) {
      return;
    }

    const currentKey = data.content.forward.source_message_key ?? null;
    data.content.forward.source_message_key = {
      ...(currentKey ?? { is_view_once: false }),
      ...sourceKey,
      is_view_once:
        sourceKey.is_view_once ??
        currentKey?.is_view_once ??
        data.message_key?.is_view_once ??
        false,
    };
  }

  private async hydrateForwardSourceKey(data: IChatMessage): Promise<void> {
    if (this.hasUsableForwardSourceKey(data)) {
      return;
    }

    const accountId = data.account?.id?.trim();
    const sourceMessageId = data.content?.forward?.source_message_id?.trim();
    if (!accountId || !sourceMessageId) {
      return;
    }

    const deadline = Date.now() + this.FORWARD_SOURCE_KEY_MAX_WAIT_MS;
    while (Date.now() <= deadline) {
      const sourceKey =
        await this.messageKeyLookupService.getMessageKeyByMessageId(
          accountId,
          sourceMessageId
        );

      if (sourceKey) {
        this.mergeForwardSourceKey(
          data,
          sourceKey as NonNullable<IChatMessage['message_key']>
        );
      }

      if (this.hasUsableForwardSourceKey(data)) {
        return;
      }

      if (Date.now() >= deadline) {
        return;
      }

      await this.sleep(this.FORWARD_SOURCE_KEY_POLL_INTERVAL_MS);
    }
  }

  private logForwardResult(
    data: IChatMessage,
    path: 'native' | 'fallback',
    result: 'success' | 'failed',
    options?: {
      reason?: ForwardFailReason;
      error?: unknown;
      nativeResolution?: 'cache';
    }
  ): void {
    console.info('[MessageSend] Forward processed', {
      source_message_id: data.content?.forward?.source_message_id ?? null,
      target_chat_id: data.chat_id,
      provider: 'baileys',
      path,
      result,
      reason: options?.reason,
      native_resolution: options?.nativeResolution,
      error:
        options?.error instanceof Error
          ? options.error.message
          : typeof options?.error === 'string'
            ? options.error
            : undefined,
    });
  }

  private buildJidAliases(jid: string): string[] {
    const normalized = normalizeJid(jid) ?? jid;
    const aliases = new Set<string>([normalized]);

    if (normalized.endsWith('@s.whatsapp.net')) {
      aliases.add(normalized.replace(/@s\.whatsapp\.net$/, '@c.us'));
    }

    if (normalized.endsWith('@c.us')) {
      aliases.add(normalized.replace(/@c\.us$/, '@s.whatsapp.net'));
    }

    return Array.from(aliases);
  }

  private resolveForwardSourceKeys(data: IChatMessage): Array<{
    remoteJid: string;
    fromMe: boolean;
    id: string;
    participant?: string;
  }> {
    const sourceKey = data.content?.forward?.source_message_key;
    if (!sourceKey?.id) {
      return [];
    }

    const rawId = sourceKey.id.trim();
    if (!rawId) {
      return [];
    }

    const parsed = parseSerializedMessageId(rawId);
    const rawJids = [
      sourceKey.remote_jid,
      sourceKey.remote_jid_alt,
      parsed?.remoteJid,
    ].filter(
      (jid): jid is string => typeof jid === 'string' && jid.trim() !== ''
    );

    const jidCandidates = new Set<string>();
    for (const jid of rawJids) {
      for (const alias of this.buildJidAliases(jid)) {
        jidCandidates.add(alias);
      }
    }

    const uniqueKeys = new Map<
      string,
      { remoteJid: string; fromMe: boolean; id: string; participant?: string }
    >();
    for (const jidCandidate of jidCandidates) {
      const built = this.buildBaileysMessageKey(
        {
          remote_jid: jidCandidate,
          from_me: sourceKey.from_me ?? null,
          id: rawId,
          participant:
            sourceKey.participant ?? sourceKey.participant_alt ?? null,
        },
        jidCandidate
      );
      if (!built?.remoteJid) {
        continue;
      }

      const dedupeKey = `${built.remoteJid}:${built.fromMe}:${built.id}:${built.participant ?? ''}`;
      uniqueKeys.set(dedupeKey, built);
    }

    return Array.from(uniqueKeys.values());
  }

  private async tryNativeForward(
    jid: string,
    data: IChatMessage,
    chatId: string,
    currentType: EMessageType | undefined
  ): Promise<{
    sent: boolean;
    reason?: ForwardFailReason;
    nativeResolution?: 'cache';
  }> {
    const sourceKeys = this.resolveForwardSourceKeys(data);
    if (sourceKeys.length === 0) {
      return {
        sent: false,
        reason: this.resolveMissingSourceReason(data),
      };
    }

    for (const sourceKey of sourceKeys) {
      const cachedMessage =
        await this.baileysIncomingMessageService.getCachedMessage(sourceKey);
      if (!cachedMessage) {
        continue;
      }

      const nativeForward = await this.baileysMessageTextService.forward(
        jid,
        {
          key: sourceKey,
          message: cachedMessage,
        },
        true
      );

      if (!nativeForward) {
        continue;
      }

      await this.pushUpdate({ message: nativeForward, data });
      if (currentType) {
        this.lastMessageTypeByChatId.set(chatId, currentType);
      }
      this.logForwardResult(data, 'native', 'success', {
        nativeResolution: 'cache',
      });
      return {
        sent: true,
        nativeResolution: 'cache',
      };
    }

    return {
      sent: false,
      reason: 'source_not_found_cache_or_store',
    };
  }

  private async processForwardMessage(
    currentType: EMessageType | undefined,
    jid: string,
    chatId: string,
    data: IChatMessage,
    lastType: EMessageType | undefined,
    hasQuoted: boolean
  ): Promise<boolean> {
    if (!data.content?.forward) {
      return false;
    }

    await this.hydrateForwardSourceKey(data);

    try {
      const nativeForwardResult = await this.tryNativeForward(
        jid,
        data,
        chatId,
        currentType
      );
      if (nativeForwardResult.sent) {
        return true;
      }
      this.logForwardResult(data, 'native', 'failed', {
        reason: nativeForwardResult.reason,
      });
    } catch (error) {
      this.logForwardResult(data, 'native', 'failed', {
        reason: 'native_forward_exception',
        error,
      });
    }

    const fallbackHandler = this.selectMessageHandler(
      currentType,
      jid,
      chatId,
      data,
      lastType,
      hasQuoted
    );

    if (!fallbackHandler) {
      this.logForwardResult(data, 'fallback', 'failed', {
        reason: 'fallback_handler_unavailable',
      });
      throw new Error('Failed to resolve forward fallback handler');
    }

    await fallbackHandler();
    this.logForwardResult(data, 'fallback', 'success');
    return true;
  }

  private async processMessage(data: IChatMessage): Promise<void> {
    const jid = selectJidChat(data);

    if (!jid) {
      throw new Error('Received message without remoteJid');
    }

    const chatId = this.resolveChatId(data);

    if (!chatId) {
      throw new Error('Received message without chatId');
    }

    const currentType = data?.content?.type;
    const lastType = this.lastMessageTypeByChatId.get(chatId);
    const hasQuoted = !!data.content?.quoted || data.has_quoted === true;

    if (
      await this.processForwardMessage(
        currentType,
        jid,
        chatId,
        data,
        lastType,
        hasQuoted
      )
    ) {
      return;
    }

    const handler = this.selectMessageHandler(
      currentType,
      jid,
      chatId,
      data,
      lastType,
      hasQuoted
    );

    if (handler) {
      await handler();
    }
  }

  private normalizeMessageKeyIdForBaileys(id?: string | null): string {
    if (!id) return '';
    const trimmed = id.trim();
    if (!trimmed) return '';

    const parsed = parseSerializedMessageId(trimmed);
    return parsed?.stanzaId ?? trimmed;
  }

  private resolveViewOnceFlag(...values: unknown[]): boolean {
    return values.some((value) => this.isTruthyViewOnce(value));
  }

  private buildOutgoingContextInfo(
    data: IChatMessage
  ): proto.IContextInfo | undefined {
    const rawContext = data.content?.context_info as
      | Record<string, unknown>
      | null
      | undefined;
    if (!rawContext) {
      return undefined;
    }

    const rawForwardingScore =
      typeof rawContext.forwarding_score === 'number'
        ? rawContext.forwarding_score
        : typeof rawContext.forwardingScore === 'number'
          ? rawContext.forwardingScore
          : undefined;

    const rawIsForwarded =
      rawContext.is_forwarded === true || rawContext.isForwarded === true;

    if (!rawIsForwarded && rawForwardingScore === undefined) {
      return undefined;
    }

    const contextInfo: Record<string, unknown> = { ...rawContext };
    delete contextInfo.is_forwarded;
    delete contextInfo.forwarding_score;

    contextInfo.isForwarded = true;
    contextInfo.forwardingScore = Math.max(
      1,
      Math.floor(rawForwardingScore ?? 1)
    );

    return contextInfo as proto.IContextInfo;
  }

  private isTruthyViewOnce(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value === 1;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return (
        normalized === '1' ||
        normalized === 'true' ||
        normalized === 'yes' ||
        normalized === 'on'
      );
    }

    return false;
  }

  private buildBaileysMessageKey(
    key:
      | {
          remote_jid?: string | null;
          remote_jid_alt?: string | null;
          from_me?: boolean | null;
          id?: string | null;
          participant?: string | null;
          participant_alt?: string | null;
          addressing_mode?: string | null;
        }
      | undefined,
    fallbackRemoteJid = ''
  ): {
    remoteJid: string;
    remoteJidAlt?: string;
    fromMe: boolean;
    id: string;
    participant?: string;
    participantAlt?: string;
    addressingMode?: string;
  } | null {
    const rawId = key?.id?.trim();
    const parsed = parseSerializedMessageId(rawId);
    const normalizedId = this.normalizeMessageKeyIdForBaileys(rawId);
    if (!normalizedId) {
      return null;
    }

    const normalizedRemoteJid =
      normalizeJid(key?.remote_jid) ??
      normalizeJid(parsed?.remoteJid) ??
      normalizeJid(fallbackRemoteJid) ??
      fallbackRemoteJid;
    const normalizedRemoteJidAlt =
      normalizeJid(key?.remote_jid_alt) ?? key?.remote_jid_alt ?? undefined;
    const normalizedParticipant =
      normalizeJid(key?.participant) ?? key?.participant ?? undefined;
    const normalizedParticipantAlt =
      normalizeJid(key?.participant_alt) ?? key?.participant_alt ?? undefined;

    return {
      remoteJid: normalizedRemoteJid,
      remoteJidAlt: normalizedRemoteJidAlt,
      fromMe: key?.from_me ?? parsed?.fromMe ?? false,
      id: normalizedId,
      participant: normalizedParticipant,
      participantAlt: normalizedParticipantAlt,
      addressingMode: key?.addressing_mode ?? undefined,
    };
  }

  private async processDelete(jid: string, data: IChatMessage): Promise<void> {
    if (!data.message_key?.id) {
      return;
    }

    const messageKey = this.buildBaileysMessageKey(data.message_key, jid);
    if (!messageKey) return;

    await this.baileysMessageEditDeleteService.deleteMessage(jid, messageKey);
  }

  private async processDocument(
    jid: string,
    data: IChatMessage
  ): Promise<void> {
    const document = data.content?.document;

    if (!document?.url) {
      throw new Error('Document URL is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const result = await this.baileysMessageMediaService.sendDocument(
      jid,
      { url: document.url },
      {
        mimetype: document.mimetype ?? 'application/octet-stream',
        fileName: document.name ?? undefined,
        caption: data.content?.message ?? undefined,
        contextInfo: this.buildOutgoingContextInfo(data),
      },
      quotedMessage ? { quoted: quotedMessage } : undefined
    );

    if (!result) {
      throw new Error('Failed to send document');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processVideo(jid: string, data: IChatMessage): Promise<void> {
    const video = data.content?.video;

    if (!video?.url) {
      throw new Error('Video URL is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const result = await this.baileysMessageMediaService.sendVideo(
      jid,
      { url: video.url },
      {
        caption: video.caption ?? data.content?.message ?? undefined,
        seconds: data.content?.video?.duration ?? undefined,
        contextInfo: this.buildOutgoingContextInfo(data),
      },
      quotedMessage ? { quoted: quotedMessage } : undefined
    );

    if (!result) {
      throw new Error('Failed to send video');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processAudio(jid: string, data: IChatMessage): Promise<void> {
    const audio = data.content?.audio;

    if (!audio?.url) {
      throw new Error('Audio URL is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const isViewOnce = this.resolveViewOnceFlag(
      data.message_key?.is_view_once,
      audio.view_once
    );
    const isPtt = isViewOnce ? true : (audio.ptt ?? true);

    let waveform: Uint8Array | undefined;
    if (isPtt && audio.waveform) {
      waveform = convertWaveformBase64ToUint8Array(audio.waveform);
    }

    const result = await this.baileysMessageMediaService.sendAudio(
      jid,
      { url: audio.url },
      {
        ptt: isPtt,
        seconds: audio.duration ?? undefined,
        mimetype: audio.mimetype ?? undefined,
        viewOnce: isViewOnce,
        waveform,
        contextInfo: this.buildOutgoingContextInfo(data),
      },
      quotedMessage ? { quoted: quotedMessage } : undefined
    );

    if (!result) {
      throw new Error('Failed to send audio');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private readonly generateVCard = (contact: {
    name: string;
    last_name?: string | null;
    phone?: string | null;
    phone_ddi?: string | null;
    email?: string | null;
    email_partial?: string | null;
  }): string => {
    const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

    const fullName = [contact.name, contact.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (fullName) {
      lines.push(`N:;${fullName};;;`, `FN:${fullName}`);
    }

    if (contact.phone) {
      let phone = contact.phone.replaceAll(/\D/g, '');
      const ddi = contact.phone_ddi
        ? contact.phone_ddi.replaceAll(/\D/g, '')
        : '';

      let phoneWithDdi = '';
      if (ddi && phone) {
        phoneWithDdi = `+${ddi}${phone}`;
      }
      if (!ddi && phone) {
        phoneWithDdi = `+${phone}`;
      }

      const phoneWithDdiWithoutPlus = phoneWithDdi.replace('+', '');

      if (phone) {
        lines.push(
          `TEL;type=CELL;type=VOICE;waid=${phoneWithDdiWithoutPlus}:${phoneWithDdi}`
        );
      }
    }

    if (contact.email) {
      lines.push(`EMAIL:${contact.email}`);
    }
    if (!contact.email && contact.email_partial) {
      lines.push(`EMAIL:${contact.email_partial}`);
    }

    lines.push('END:VCARD');
    return lines.join('\n');
  };

  private async processContact(jid: string, data: IChatMessage): Promise<void> {
    const contactData = data.content?.contact;

    if (!contactData) {
      throw new Error('Contact data is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const vcard = this.generateVCard(contactData);

    const displayName =
      `${contactData.name} ${contactData.last_name ?? ''}`.trim() || 'Contato';

    const result =
      await this.baileysMessageLocationContactService.sendContactCard(
        jid,
        vcard,
        displayName,
        this.buildOutgoingContextInfo(data),
        quotedMessage ? { quoted: quotedMessage } : undefined
      );

    if (!result) {
      throw new Error('Failed to send contact');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processContacts(
    jid: string,
    data: IChatMessage
  ): Promise<void> {
    const contacts = data.content?.contacts ?? [];

    if (!contacts.length) {
      throw new Error('Contacts data is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const vcards = contacts.map((contact) => this.generateVCard(contact));
    const firstContact = contacts[0];
    const firstName =
      `${firstContact?.name ?? ''} ${firstContact?.last_name ?? ''}`.trim() ||
      'Contato';
    const displayName =
      contacts.length > 1
        ? `${firstName} e ${contacts.length - 1} outro contato`
        : firstName;

    const result = await this.baileysMessageLocationContactService.sendContacts(
      jid,
      vcards,
      displayName,
      this.buildOutgoingContextInfo(data),
      quotedMessage ? { quoted: quotedMessage } : undefined
    );

    if (!result) {
      throw new Error('Failed to send contacts');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processReact(jid: string, data: IChatMessage): Promise<void> {
    if (!data.message_key?.id || !data.content?.reactions) {
      return;
    }

    const lastReaction = data.content.reactions.at(-1);
    if (!lastReaction) {
      return;
    }

    const messageKey = this.buildBaileysMessageKey(data.message_key, jid);
    if (!messageKey) return;

    const result = await this.baileysMessageReactionsInteractionsService.react(
      jid,
      messageKey,
      lastReaction.emoji
    );

    if (!result) {
      throw new Error('Failed to send reaction');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processText(jid: string, data: IChatMessage): Promise<void> {
    const hasVersions =
      data.content?.version && data.content.version.length > 0;
    const hasMessageKey = !!data.message_key?.id;

    if (hasVersions && hasMessageKey && data.message_key && data.content) {
      if (data.message_key.from_me !== true) {
        throw new Error('Message edit is not allowed for non-own message');
      }

      const messageKey = this.buildBaileysMessageKey(data.message_key, jid);
      if (!messageKey) {
        return;
      }

      const latestVersion = data.content.version
        ? [...data.content.version].sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          )[0]
        : null;

      const newText = latestVersion?.message ?? data.content?.message ?? '';

      let result: WAMessage | undefined;
      try {
        result = await this.baileysMessageEditDeleteService.editText(
          jid,
          newText,
          messageKey
        );
      } catch (error) {
        this.logPipelineEvent(
          'edit_send_failed',
          {
            chat_id: data.chat_id,
            message_id: data.message_id,
            edit_key_id: messageKey.id,
            edit_remote_jid: messageKey.remoteJid,
            edit_addressing_mode: messageKey.addressingMode,
            error: this.errorMessage(error),
          },
          'warn'
        );

        throw error;
      }

      if (!result) {
        this.logPipelineEvent(
          'edit_send_failed',
          {
            chat_id: data.chat_id,
            message_id: data.message_id,
            edit_key_id: messageKey.id,
            edit_remote_jid: messageKey.remoteJid,
            edit_addressing_mode: messageKey.addressingMode,
            error: 'empty_result',
          },
          'warn'
        );

        throw new Error('Failed to edit message');
      }

      const update: IUpdateMessage = { message: result, data };
      await this.pushUpdate(update);
      return;
    }

    const result = await this.baileysMessageTextService.sendText(
      jid,
      data.content?.message ?? '',
      {
        linkPreview: data.content?.link_preview as WAUrlInfo,
        contextInfo: this.buildOutgoingContextInfo(data),
      }
    );

    if (!result) {
      throw new Error('Failed to send message');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async handleStatusResult(
    result: WAMessage | null | undefined,
    workerProfileStatusId: string,
    errorMessage: string
  ): Promise<void> {
    if (!result) {
      throw new Error(errorMessage);
    }

    if (result?.key?.id) {
      await this.sendExternalIdUpdate(workerProfileStatusId, result.key.id);
    }
  }

  private async processStatusText(
    jid: string,
    data: IProfileStatusMessage,
    statusJidList: string[]
  ): Promise<void> {
    const result = await this.baileysMessageStatusStoriesService.sendStatusText(
      jid,
      data.value,
      {
        statusJidList,
      }
    );

    await this.handleStatusResult(
      result,
      data.worker_profile_status_id,
      'Failed to send status text'
    );
  }

  private async processStatusImage(
    jid: string,
    url: string,
    caption: string | undefined,
    data: IProfileStatusMessage,
    statusJidList: string[]
  ): Promise<void> {
    const result =
      await this.baileysMessageStatusStoriesService.sendStatusImage(
        jid,
        { url },
        {
          caption,
          statusJidList,
        }
      );

    await this.handleStatusResult(
      result,
      data.worker_profile_status_id,
      'Failed to send status image'
    );
  }

  private async processStatusVideo(
    jid: string,
    url: string,
    caption: string | undefined,
    data: IProfileStatusMessage,
    statusJidList: string[]
  ): Promise<void> {
    const result =
      await this.baileysMessageStatusStoriesService.sendStatusVideo(
        jid,
        { url },
        {
          caption,
          statusJidList,
        }
      );

    await this.handleStatusResult(
      result,
      data.worker_profile_status_id,
      'Failed to send status video'
    );
  }

  private async processStatusAudio(
    jid: string,
    url: string,
    caption: string | undefined,
    data: IProfileStatusMessage,
    statusJidList: string[]
  ): Promise<void> {
    const result =
      await this.baileysMessageStatusStoriesService.sendStatusAudio(
        jid,
        { url },
        {
          caption,
          statusJidList,
        }
      );

    await this.handleStatusResult(
      result,
      data.worker_profile_status_id,
      'Failed to send status audio'
    );
  }

  private async processProfileStatus(
    data: IProfileStatusMessage
  ): Promise<void> {
    const jid = 'status@broadcast';
    const valueParts = data.value.split('|');
    const url = valueParts[0];
    const caption =
      valueParts.length > 1 ? valueParts.slice(1).join('|') : undefined;

    const statusJidList = data.statusJidList ?? [];

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.text) {
      await this.processStatusText(jid, data, statusJidList);
      return;
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.image) {
      await this.processStatusImage(jid, url, caption, data, statusJidList);
      return;
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.video) {
      await this.processStatusVideo(jid, url, caption, data, statusJidList);
      return;
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.audio) {
      await this.processStatusAudio(jid, url, caption, data, statusJidList);
    }
  }

  private async processDeleteStatus(
    data: IProfileStatusDeleteMessage
  ): Promise<void> {
    await this.baileysMessageStatusStoriesService.deleteStatus(
      data.external_id,
      data.statusJidList
    );
  }

  private async processProfileInfo(data: IProfileInfoMessage): Promise<void> {
    if (data.name) {
      await this.baileysProfileService.updateProfileName(data.name);
    }

    if (data.message) {
      await this.baileysProfileService.updateProfileStatus(data.message);
    }

    if (data.photo === null) {
      await this.baileysProfileService.removeProfilePicture();
      return;
    }

    if (data.photo) {
      await this.baileysProfileService.updateProfilePicture(data.photo);
    }
  }

  private async processImage(jid: string, data: IChatMessage): Promise<void> {
    const imageUrl = data.content?.image?.url;

    if (!imageUrl) {
      throw new Error('Image URL is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const result = await this.baileysMessageMediaService.sendImage(
      jid,
      { url: imageUrl },
      {
        caption: data.content?.image?.caption ?? undefined,
        contextInfo: this.buildOutgoingContextInfo(data),
      },
      quotedMessage ? { quoted: quotedMessage } : undefined
    );

    if (!result) {
      throw new Error('Failed to send image');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processSticker(jid: string, data: IChatMessage): Promise<void> {
    const sticker = data.content?.sticker;

    if (!sticker?.url) {
      throw new Error('Sticker URL is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const result = await this.baileysMessageMediaService.sendSticker(
      jid,
      { url: sticker.url },
      {
        isAnimated: sticker.is_animated ?? false,
        width: sticker.width ?? undefined,
        height: sticker.height ?? undefined,
        contextInfo: this.buildOutgoingContextInfo(data),
      },
      quotedMessage ? { quoted: quotedMessage } : undefined
    );

    if (!result) {
      throw new Error('Failed to send sticker');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processLocation(
    jid: string,
    data: IChatMessage
  ): Promise<void> {
    const location = data.content?.location;

    if (!location?.latitude || !location?.longitude) {
      throw new Error('Location coordinates are required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const result = await this.baileysMessageLocationContactService.sendLocation(
      jid,
      {
        degreesLatitude: location.latitude,
        degreesLongitude: location.longitude,
        name: location.name ?? undefined,
        address: location.address ?? undefined,
        contextInfo: this.buildOutgoingContextInfo(data),
      },
      quotedMessage ? { quoted: quotedMessage } : undefined
    );

    if (!result) {
      throw new Error('Failed to send location');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processTextQuoted(
    jid: string,
    data: IChatMessage
  ): Promise<void> {
    const quoted = this.composeQuotedMessage(data);

    const result = await this.baileysMessageTextService.sendTextQuoted(
      jid,
      data.content?.message ?? '',
      quoted
    );

    if (!result) {
      throw new Error('Failed to send message');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private extractBase64FromThumbnail(thumb: string | null): string | null {
    if (!thumb) return null;
    if (!thumb.startsWith('data:')) return thumb;
    return thumb.split(',')[1] ?? null;
  }

  private createQuotedImageMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.image) return null;

    const thumb = q.image?.thumbnail ?? null;
    const base64 = this.extractBase64FromThumbnail(thumb);

    return {
      imageMessage: {
        caption: q.image?.caption ?? undefined,
        jpegThumbnail: base64 ? Buffer.from(base64, 'base64') : undefined,
      },
    };
  }

  private createQuotedVideoMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.video) return null;

    const thumb = q.video?.thumbnail ?? null;
    const base64 = this.extractBase64FromThumbnail(thumb);

    return {
      videoMessage: {
        caption: q.video?.caption ?? undefined,
        jpegThumbnail: base64 ? Buffer.from(base64, 'base64') : undefined,
        fileLength: q.video?.size ?? undefined,
        mimetype: q.video?.mimetype ?? undefined,
      },
    };
  }

  private createQuotedDocumentMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.document || !q?.document) return null;

    return {
      documentMessage: {
        fileName: q.document.name ?? undefined,
        mimetype: q.document.mimetype ?? undefined,
        caption: q.message ?? undefined,
        fileLength: q.document.size ?? undefined,
      },
    };
  }

  private createQuotedAudioMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.audio || !q?.audio) return null;

    return {
      audioMessage: {
        ptt: q.audio.ptt ?? true,
        seconds: q.audio.duration ?? undefined,
        mimetype: q.audio.mimetype ?? undefined,
      },
    };
  }

  private createQuotedStickerMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.sticker || !q?.sticker) return null;

    return {
      stickerMessage: {
        mimetype: q.sticker.mimetype ?? 'image/webp',
        isAnimated: q.sticker.is_animated ?? false,
        fileLength: q.sticker.size ?? undefined,
        width: q.sticker.width ?? undefined,
        height: q.sticker.height ?? undefined,
      },
    };
  }

  private createQuotedLocationMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.location || !q?.location) return null;

    return {
      locationMessage: {
        degreesLatitude: q.location.latitude ?? undefined,
        degreesLongitude: q.location.longitude ?? undefined,
        name: q.location.name ?? undefined,
        address: q.location.address ?? undefined,
      },
    };
  }

  private createQuotedContactMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type === EMessageType.contact_card && q?.contact) {
      const vcardLines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

      const fullName = [q.contact.name, q.contact.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();

      if (fullName) {
        vcardLines.push(`N:;${fullName};;;`, `FN:${fullName}`);
      }

      if (q.contact.phone) {
        vcardLines.push(`TEL:${q.contact.phone}`);
      }

      if (q.contact.email) {
        vcardLines.push(`EMAIL:${q.contact.email}`);
      }

      vcardLines.push('END:VCARD');
      const vcard = vcardLines.join('\n');

      return {
        contactMessage: {
          displayName: fullName || 'Contato',
          vcard,
        },
      };
    }

    if (q?.type === EMessageType.contacts) {
      const quotedContent = q as any;
      if (quotedContent?.contacts && quotedContent.contacts.length > 0) {
        const firstContact = quotedContent.contacts[0] as IContactMessage;

        const vcardLines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

        const fullName = [firstContact.name, firstContact.last_name]
          .filter(Boolean)
          .join(' ')
          .trim();

        if (fullName) {
          vcardLines.push(`N:;${fullName};;;`, `FN:${fullName}`);
        }

        if (firstContact.phone) {
          vcardLines.push(`TEL:${firstContact.phone}`);
        }

        if (firstContact.email) {
          vcardLines.push(`EMAIL:${firstContact.email}`);
        }

        vcardLines.push('END:VCARD');
        const vcard = vcardLines.join('\n');

        const displayName =
          quotedContent.contacts.length === 1
            ? fullName || 'Contato'
            : `${firstContact.name} e ${quotedContent.contacts.length - 1} outro contato`;

        return {
          contactMessage: {
            displayName,
            vcard,
          },
        };
      }
    }

    return null;
  }

  private createQuotedTextMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (
      (q?.type !== EMessageType.text && q?.type !== EMessageType.system) ||
      !q?.message
    )
      return null;

    return {
      conversation: q.message,
    };
  }

  private composeQuotedMessage(data: IChatMessage): WAMessage {
    const q = data.content?.quoted;

    const rawQuotedId = q?.key.id?.trim();
    const parsedQuotedId = parseSerializedMessageId(rawQuotedId);
    const normalizedQuotedId =
      this.normalizeMessageKeyIdForBaileys(rawQuotedId);

    const quoted: WAMessage = {
      key: {
        remoteJid: q?.key.remote_jid ?? parsedQuotedId?.remoteJid ?? '',
        fromMe: q?.key.from_me ?? parsedQuotedId?.fromMe ?? false,
        id: normalizedQuotedId,
        participant: q?.key.participant || undefined,
      },
      message: null,
    };

    if (!q) {
      return quoted;
    }

    const messageCreators = [
      () => this.createQuotedTextMessage(q),
      () => this.createQuotedImageMessage(q),
      () => this.createQuotedVideoMessage(q),
      () => this.createQuotedDocumentMessage(q),
      () => this.createQuotedAudioMessage(q),
      () => this.createQuotedStickerMessage(q),
      () => this.createQuotedLocationMessage(q),
      () => this.createQuotedContactMessage(q),
    ];

    for (const creator of messageCreators) {
      const message = creator();
      if (message) {
        quoted.message = message;
        break;
      }
    }

    return quoted;
  }

  private async pushUpdate(input: IUpdateMessage): Promise<void> {
    const topic = this.kafkaServiceQueueService.updateMessage();
    await this.streamProducerService.send(topic, input);

    const outgoingMessage = input.message as
      | (WAMessage & { key?: unknown; message?: unknown })
      | undefined;

    if (!outgoingMessage?.key || !outgoingMessage?.message) {
      return;
    }

    try {
      await this.baileysIncomingMessageService.cacheOutgoingForwardableMessage(
        outgoingMessage
      );
    } catch {}
  }

  private async sendExternalIdUpdate(
    workerProfileStatusId: string,
    externalId: string
  ): Promise<void> {
    const updateMessage: IUpdateProfileStatusExternalId = {
      worker_profile_status_id: workerProfileStatusId,
      external_id: externalId,
    };

    const topic = this.kafkaServiceQueueService.updateProfileStatusExternalId();
    await this.streamProducerService.send(topic, updateMessage);
  }
}
