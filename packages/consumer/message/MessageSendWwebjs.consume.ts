import { singleton, inject } from 'tsyringe';
import { wwebjsEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { WwebjsMessageTextService } from '@core/services/wwebjs/methods/messageText.service';
import { WwebjsMessageMediaService } from '@core/services/wwebjs/methods/messageMedia.service';
import { WwebjsMessageReactionsInteractionsService } from '@core/services/wwebjs/methods/messageReactionsInteractions.service';
import { WwebjsMessageEditDeleteService } from '@core/services/wwebjs/methods/messageEditDelete.service';
import { WwebjsMessageLocationContactService } from '@core/services/wwebjs/methods/messageLocationContact.service';
import { WwebjsMessageStatusStoriesService } from '@core/services/wwebjs/methods/messageStatusStories.service';
import { WwebjsProfileService } from '@core/services/wwebjs/methods/profile.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IProfileStatusMessage } from '@core/common/interfaces/IProfileStatusMessage';
import { IProfileStatusDeleteMessage } from '@core/common/interfaces/IProfileStatusDeleteMessage';
import { IProfileInfoMessage } from '@core/common/interfaces/IProfileInfoMessage';
import { IUpdateProfileStatusExternalId } from '@core/common/interfaces/IUpdateProfileStatusExternalId';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { IWorkerSendMessageDlq } from '@core/common/interfaces/IWorkerSendMessageDlq';
import { Buffer } from 'node:buffer';
import { KeyedSequencerService } from '@core/services/keyedSequencer.service';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { selectJidChat } from '@core/common/functions/selectJidChat';
import { convertWaveformBase64ToUint8Array } from '@core/common/functions/convertWaveform';
import { EWorkerProfileStatusType } from '@core/common/enums/EWorkerProfileStatusType';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { webcrypto } from 'node:crypto';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';
import { MessageKeyLookupService } from '@core/services/messageKeyLookup.service';
import { buildForwardExtraOptions } from '@core/services/wwebjs/util/buildForwardExtraOptions';
import { isMessageDeliveryConfirmationFailedError } from '@core/common/exceptions/MessageDeliveryConfirmationFailedError';
import { MessageStatusService } from '@core/services/messageStatus.service';
import Redis from 'ioredis';
import { logger } from '@core/plugins/telemetry/logger';
import {
  recordException,
  incrementCounter,
  recordHistogram,
} from '@core/plugins/telemetry/observability';

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

interface INonRetryableError extends Error {
  readonly nonRetryable: true;
}

@singleton()
export class MessageSendWwebjsConsume {
  private readonly PROVIDER = 'wwebjs';
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
  private readonly REDRIVE_COUNT_FIELD = '__wwebjs_redrive_count';
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
    @inject(WwebjsMessageTextService)
    private readonly wwebjsMessageTextService: WwebjsMessageTextService,
    @inject(WwebjsMessageMediaService)
    private readonly wwebjsMessageMediaService: WwebjsMessageMediaService,
    @inject(WwebjsMessageReactionsInteractionsService)
    private readonly wwebjsMessageReactionsInteractionsService: WwebjsMessageReactionsInteractionsService,
    @inject(WwebjsMessageEditDeleteService)
    private readonly wwebjsMessageEditDeleteService: WwebjsMessageEditDeleteService,
    @inject(WwebjsMessageLocationContactService)
    private readonly wwebjsMessageLocationContactService: WwebjsMessageLocationContactService,
    @inject(WwebjsMessageStatusStoriesService)
    private readonly wwebjsMessageStatusStoriesService: WwebjsMessageStatusStoriesService,
    @inject(WwebjsProfileService)
    private readonly wwebjsProfileService: WwebjsProfileService,
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
    @inject('Redis') private readonly redis: Redis
  ) {}

  private logPipelineEvent(
    event: string,
    details: Record<string, unknown> = {},
    level: 'info' | 'warn' | 'error' = 'info'
  ): void {
    const payload = {
      module: 'worker_wwebjs',
      component: 'message_send_consume',
      type: 'message_send_pipeline',
      provider: this.PROVIDER,
      event,
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
      account_id: wwebjsEnvironment.wwebjsAccountId,
      ...details,
    };

    if (level === 'error') {
      logger.error(payload, 'Wwebjs message send pipeline event');
      return;
    }

    if (level === 'warn') {
      logger.warn(payload, 'Wwebjs message send pipeline event');
      return;
    }

    logger.info(payload, 'Wwebjs message send pipeline event');
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
        wwebjsEnvironment.wwebjsAccountId,
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
      wwebjsEnvironment.wwebjsWorkerId
    );
    const dlqTopic = this.kafkaBaileysQueueService.workerSendMessageDlq(
      wwebjsEnvironment.wwebjsWorkerId
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
      `group-underchat-wwebjs-send-${wwebjsEnvironment.wwebjsWorkerId}`
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

    for (let attempt = 1; attempt <= this.MAX_PROCESS_ATTEMPTS; attempt++) {
      const startedAt = Date.now();
      try {
        await this.processPayload(envelope.payload);
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
        const terminalReason = this.resolveTerminalReason(error);

        if (terminalReason) {
          this.logPipelineEvent(
            'terminal_skipped',
            {
              chat_id: envelope.chatId,
              queue_key: envelope.queueKey,
              partition: envelope.partition,
              offset: envelope.offset,
              message_id: messageId,
              redrive_count: redriveCount,
              attempt,
              result: 'terminal',
              error: terminalReason,
            },
            'warn'
          );
          incrementCounter(
            'message_send_error',
            1,
            this.baseMetricAttributes(
              envelope,
              'terminal',
              attempt,
              redriveCount
            )
          );
          return;
        }

        const isLastAttempt = attempt === this.MAX_PROCESS_ATTEMPTS;

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
      this.MAX_PROCESS_ATTEMPTS,
      this.MAX_PROCESS_ATTEMPTS,
      'processing_failed'
    );
  }

  private async processPayload(payload: unknown): Promise<void> {
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
          '[MessageSendWwebjs] Send payload without chatId. Message skipped.'
        );
        return;
      }

      await this.processMessage(payload);
      return;
    }

    console.warn(
      '[MessageSendWwebjs] Unsupported payload type. Message skipped.'
    );
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
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
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

  private nonRetryableError(message: string): INonRetryableError {
    const error = new Error(message) as INonRetryableError;
    Object.defineProperty(error, 'nonRetryable', {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return error;
  }

  private resolveTerminalReason(error: unknown): string | null {
    if (
      error instanceof Error &&
      (error as Partial<INonRetryableError>).nonRetryable === true
    ) {
      return error.message;
    }

    return null;
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

  private getQuotedKey(data: IChatMessage):
    | {
        key: {
          id: string;
          remote_jid?: string | null;
          remote_jid_alt?: string | null;
          from_me?: boolean | null;
          participant?: string | null;
          participant_alt?: string | null;
        };
      }
    | undefined {
    const quotedKey = data.content?.quoted?.key;
    const id = quotedKey?.id;
    if (!id) return undefined;

    return {
      key: {
        id,
        remote_jid: quotedKey.remote_jid ?? null,
        remote_jid_alt: quotedKey.remote_jid_alt ?? null,
        from_me: quotedKey.from_me ?? null,
        participant: quotedKey.participant ?? null,
        participant_alt: quotedKey.participant_alt ?? null,
      },
    };
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
      nativeResolution?: 'direct' | 'snapshot_poll' | 'unresolved';
    }
  ): void {
    console.info('[MessageSendWwebjs] Forward processed', {
      source_message_id: data.content?.forward?.source_message_id ?? null,
      target_chat_id: data.chat_id,
      provider: 'wwebjs',
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

  private buildForwardSourceKey(data: IChatMessage): {
    remoteJid: string;
    fromMe: boolean;
    id: string;
    participant?: string;
  } | null {
    const sourceKey = data.content?.forward?.source_message_key;
    if (!sourceKey?.id) {
      return null;
    }

    const parsed = parseSerializedMessageId(sourceKey.id);
    const remoteJid = sourceKey.remote_jid ?? parsed?.remoteJid ?? '';
    if (!remoteJid) {
      return null;
    }

    return {
      remoteJid,
      fromMe: sourceKey.from_me ?? parsed?.fromMe ?? false,
      id: sourceKey.id,
      participant: sourceKey.participant ?? undefined,
    };
  }

  private async processForwardFallback(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined,
    hasQuoted: boolean,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (
      await this.processTextOrSystemMessage(
        data,
        jid,
        chatId,
        currentType,
        hasQuoted,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processImageMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processDocumentMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processAudioMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processVideoMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processStickerMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processLocationMessage(
        data,
        jid,
        chatId,
        currentType,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processContactCardMessage(
        data,
        jid,
        chatId,
        currentType,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processContactsMessage(
        data,
        jid,
        chatId,
        currentType,
        forwardExtra
      )
    )
      return true;

    return false;
  }

  private async processForwardMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined,
    hasQuoted: boolean
  ): Promise<boolean> {
    if (!data.content?.forward) {
      return false;
    }

    await this.hydrateForwardSourceKey(data);

    const sourceKey = this.buildForwardSourceKey(data);

    if (sourceKey) {
      try {
        const nativeResult =
          await this.wwebjsMessageEditDeleteService.forwardMessage(
            jid,
            sourceKey
          );
        if (nativeResult.sent) {
          if (nativeResult.messageKey) {
            await this.pushUpdate({ message: nativeResult.messageKey, data });
          }
          if (currentType) {
            this.lastMessageTypeByChatId.set(chatId, currentType);
          }
          this.logForwardResult(data, 'native', 'success', {
            nativeResolution: nativeResult.resolution_path,
          });
          return true;
        }
        this.logForwardResult(data, 'native', 'failed', {
          reason: 'source_not_found_cache_or_store',
          error: nativeResult.error,
          nativeResolution: nativeResult.resolution_path,
        });
      } catch (error) {
        this.logForwardResult(data, 'native', 'failed', {
          reason: 'native_forward_exception',
          error,
        });
      }
    } else {
      this.logForwardResult(data, 'native', 'failed', {
        reason: this.resolveMissingSourceReason(data),
      });
    }

    const forwardExtra = buildForwardExtraOptions(data);
    const fallbackResult = await this.processForwardFallback(
      data,
      jid,
      chatId,
      currentType,
      lastType,
      hasQuoted,
      forwardExtra
    );

    if (!fallbackResult) {
      this.logForwardResult(data, 'fallback', 'failed', {
        reason: 'fallback_handler_unavailable',
      });
      throw new Error('Failed to resolve forward fallback handler');
    }

    this.logForwardResult(data, 'fallback', 'success');
    return true;
  }

  private async processMessage(data: IChatMessage): Promise<void> {
    const jid = selectJidChat(data);
    if (!jid) throw new Error('Received message without remoteJid');
    const chatId = this.resolveChatId(data);
    if (!chatId) throw new Error('Received message without chatId');
    const currentType = data?.content?.type;
    const lastType = this.lastMessageTypeByChatId.get(chatId);
    const hasQuoted = !!data.content?.quoted || data.has_quoted === true;

    if (
      await this.processForwardMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType,
        hasQuoted
      )
    )
      return;

    if (
      await this.processTextOrSystemMessage(
        data,
        jid,
        chatId,
        currentType,
        hasQuoted
      )
    )
      return;
    if (
      await this.processImageMessage(data, jid, chatId, currentType, lastType)
    )
      return;
    if (
      await this.processDocumentMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType
      )
    )
      return;
    if (
      await this.processAudioMessage(data, jid, chatId, currentType, lastType)
    )
      return;
    if (
      await this.processVideoMessage(data, jid, chatId, currentType, lastType)
    )
      return;
    if (
      await this.processStickerMessage(data, jid, chatId, currentType, lastType)
    )
      return;
    if (await this.processLocationMessage(data, jid, chatId, currentType))
      return;
    if (await this.processContactCardMessage(data, jid, chatId, currentType))
      return;
    if (await this.processContactsMessage(data, jid, chatId, currentType))
      return;
    if (await this.processDeleteMessage(data, jid, chatId, currentType)) return;
    await this.processReactMessage(data, jid, chatId, currentType);
  }

  private async processTextOrSystemMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    hasQuoted: boolean,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (
      currentType !== EMessageType.text &&
      currentType !== EMessageType.system
    ) {
      return false;
    }

    const hasVersions = !!data.content?.version?.length;
    const messageKey = data.message_key;
    const hasMessageKey = !!messageKey?.id;

    if (currentType === EMessageType.text && hasVersions && hasMessageKey) {
      if (messageKey?.from_me !== true) {
        throw this.nonRetryableError(
          'Message edit is not allowed for non-own message'
        );
      }

      const latestVersion = data.content?.version
        ? [...data.content.version].sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          )[0]
        : null;

      const newText = latestVersion?.message ?? data.content?.message ?? '';

      const result = await this.wwebjsMessageEditDeleteService.editText(
        newText,
        {
          remoteJid: messageKey?.remote_jid ?? jid,
          fromMe: messageKey?.from_me ?? false,
          id: messageKey?.id ?? '',
          participant: messageKey?.participant ?? undefined,
        }
      );

      if (!result) {
        throw this.nonRetryableError('Failed to edit message');
      }

      await this.pushUpdate({ message: result, data });
      this.lastMessageTypeByChatId.set(chatId, EMessageType.text);
      return true;
    }

    const quotedKey = this.getQuotedKey(data);

    if (hasQuoted && quotedKey) {
      const result = await this.wwebjsMessageTextService.sendTextQuoted(
        jid,
        data.content?.message ?? '',
        quotedKey,
        { extra: forwardExtra }
      );
      if (result) await this.pushUpdate({ message: result, data });
      this.lastMessageTypeByChatId.set(chatId, EMessageType.text);
      return true;
    }

    if (hasQuoted && !quotedKey) {
      console.warn(
        '[MessageSendWwebjs] Quoted flag is true but quoted key is missing. Sending as regular text.'
      );
    }

    const result = await this.wwebjsMessageTextService.sendText(
      jid,
      data.content?.message ?? '',
      {
        linkPreview: data.content?.link_preview as {
          title?: string;
          description?: string;
        } | null,
        extra: forwardExtra,
      }
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.text);
    return true;
  }

  private async processImageMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (currentType !== EMessageType.image || !data.content?.image?.url)
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const result = await this.wwebjsMessageMediaService.sendImage(
      jid,
      { url: data.content.image.url },
      {
        caption: data.content.image.caption ?? undefined,
        extra: forwardExtra,
      },
      this.getQuotedKey(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.image);
    return true;
  }

  private async processDocumentMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (currentType !== EMessageType.document || !data.content?.document?.url)
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const result = await this.wwebjsMessageMediaService.sendDocument(
      jid,
      { url: data.content.document.url },
      {
        mimetype: data.content.document.mimetype ?? 'application/octet-stream',
        fileName: data.content.document.name ?? undefined,
        caption: data.content?.message ?? undefined,
        extra: forwardExtra,
      },
      this.getQuotedKey(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.document);
    return true;
  }

  private async processAudioMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (currentType !== EMessageType.audio || !data.content?.audio?.url)
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const waveform =
      data.content.audio.ptt && data.content.audio.waveform
        ? convertWaveformBase64ToUint8Array(data.content.audio.waveform)
        : undefined;
    const result = await this.wwebjsMessageMediaService.sendAudio(
      jid,
      { url: data.content.audio.url },
      {
        ptt: data.content.audio.ptt ?? true,
        seconds: data.content.audio.duration ?? undefined,
        mimetype: data.content.audio.mimetype ?? undefined,
        viewOnce:
          data.message_key?.is_view_once ??
          data.content.audio.view_once ??
          undefined,
        waveform,
        extra: forwardExtra,
      },
      this.getQuotedKey(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.audio);
    return true;
  }

  private async processVideoMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (
      (currentType !== EMessageType.video &&
        currentType !== EMessageType.video_note) ||
      !data.content?.video?.url
    )
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const result = await this.wwebjsMessageMediaService.sendVideo(
      jid,
      { url: data.content.video.url },
      {
        caption:
          data.content.video.caption ?? data.content?.message ?? undefined,
        seconds: data.content.video.duration ?? undefined,
        extra: forwardExtra,
      },
      this.getQuotedKey(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, currentType);
    return true;
  }

  private async processStickerMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (currentType !== EMessageType.sticker || !data.content?.sticker?.url)
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const result = await this.wwebjsMessageMediaService.sendSticker(
      jid,
      { url: data.content.sticker.url },
      this.getQuotedKey(data),
      forwardExtra
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.sticker);
    return true;
  }

  private async processLocationMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (currentType !== EMessageType.location || !data.content?.location)
      return false;
    const loc = data.content.location;
    const result = await this.wwebjsMessageLocationContactService.sendLocation(
      jid,
      {
        degreesLatitude: loc.latitude ?? 0,
        degreesLongitude: loc.longitude ?? 0,
        name: loc.name ?? undefined,
        address: loc.address ?? undefined,
      },
      this.getQuotedKey(data),
      forwardExtra
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.location);
    return true;
  }

  private async processContactCardMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (currentType !== EMessageType.contact_card || !data.content?.contact)
      return false;
    const contactData = data.content.contact;
    const vcardLines = ['BEGIN:VCARD', 'VERSION:3.0'];
    const fullName = [contactData.name, contactData.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (fullName) {
      vcardLines.push(`N:;${fullName};;;`, `FN:${fullName}`);
    }
    if (contactData.phone) vcardLines.push(`TEL:${contactData.phone}`);
    if (contactData.email) vcardLines.push(`EMAIL:${contactData.email}`);
    vcardLines.push('END:VCARD');
    const vcard = vcardLines.join('\n');
    const result =
      await this.wwebjsMessageLocationContactService.sendContactCard(
        jid,
        vcard,
        this.getQuotedKey(data),
        forwardExtra
      );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.contact_card);
    return true;
  }

  private async processContactsMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (
      currentType !== EMessageType.contacts ||
      !data.content?.contacts?.length
    )
      return false;

    const firstContact = data.content.contacts[0];
    const vcardLines = ['BEGIN:VCARD', 'VERSION:3.0'];
    const fullName = [firstContact.name, firstContact.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (fullName) {
      vcardLines.push(`N:;${fullName};;;`, `FN:${fullName}`);
    }
    if (firstContact.phone) vcardLines.push(`TEL:${firstContact.phone}`);
    if (firstContact.email) vcardLines.push(`EMAIL:${firstContact.email}`);
    vcardLines.push('END:VCARD');

    const result =
      await this.wwebjsMessageLocationContactService.sendContactCard(
        jid,
        vcardLines.join('\n'),
        this.getQuotedKey(data),
        forwardExtra
      );

    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.contacts);
    return true;
  }

  private async processDeleteMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined
  ): Promise<boolean> {
    if (currentType !== EMessageType.delete_message || !data.message_key?.id) {
      return false;
    }
    const key = {
      remoteJid: data.message_key.remote_jid ?? jid,
      fromMe: data.message_key.from_me ?? false,
      id: data.message_key.id,
      participant: data.message_key.participant ?? undefined,
    };
    await this.wwebjsMessageEditDeleteService.deleteMessage(key);
    this.lastMessageTypeByChatId.set(chatId, EMessageType.delete_message);
    return true;
  }

  private async processReactMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined
  ): Promise<void> {
    if (currentType !== EMessageType.react || !data.message_key?.id) {
      return;
    }

    const emojiFromMessage =
      typeof data.content?.message === 'string' ? data.content.message : null;
    const lastReaction = data.content?.reactions?.at(-1);
    const emoji = emojiFromMessage ?? lastReaction?.emoji;
    if (emoji === undefined) {
      return;
    }

    const key = {
      remoteJid: jid,
      fromMe: data.message_key.from_me ?? false,
      id: data.message_key.id,
      participant: data.message_key.participant ?? undefined,
    };

    const result = await this.wwebjsMessageReactionsInteractionsService.react(
      key,
      emoji
    );
    if (!result) {
      throw new Error('Failed to send reaction');
    }

    this.lastMessageTypeByChatId.set(chatId, EMessageType.react);
  }

  private async processProfileStatus(
    data: IProfileStatusMessage
  ): Promise<void> {
    const jid = 'status@broadcast';
    const valueParts = data.value.split('|');
    const url = valueParts[0];
    const caption =
      valueParts.length > 1 ? valueParts.slice(1).join('|') : undefined;

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.text) {
      const result =
        await this.wwebjsMessageStatusStoriesService.sendStatusText(
          jid,
          data.value
        );
      if (result?.key?.id) {
        await this.sendExternalIdUpdate(
          data.worker_profile_status_id,
          result.key.id
        );
      }
      return;
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.image) {
      const result =
        await this.wwebjsMessageStatusStoriesService.sendStatusImage(
          jid,
          { url },
          { caption }
        );
      if (result?.key?.id) {
        await this.sendExternalIdUpdate(
          data.worker_profile_status_id,
          result.key.id
        );
      }
      return;
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.video) {
      const result =
        await this.wwebjsMessageStatusStoriesService.sendStatusVideo(
          jid,
          { url },
          { caption }
        );
      if (result?.key?.id) {
        await this.sendExternalIdUpdate(
          data.worker_profile_status_id,
          result.key.id
        );
      }
      return;
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.audio) {
      const result =
        await this.wwebjsMessageStatusStoriesService.sendStatusAudio(
          jid,
          { url },
          { caption }
        );
      if (result?.key?.id) {
        await this.sendExternalIdUpdate(
          data.worker_profile_status_id,
          result.key.id
        );
      }
    }
  }

  private async processDeleteStatus(
    data: IProfileStatusDeleteMessage
  ): Promise<void> {
    await this.wwebjsMessageStatusStoriesService.deleteStatus(data.external_id);
  }

  private async processProfileInfo(data: IProfileInfoMessage): Promise<void> {
    if (data.name) {
      await this.wwebjsProfileService.updateProfileName(data.name);
    }

    if (data.message) {
      await this.wwebjsProfileService.updateProfileStatus(data.message);
    }

    if (data.photo === null) {
      await this.wwebjsProfileService.removeProfilePicture();
      return;
    }

    if (data.photo) {
      await this.wwebjsProfileService.updateProfilePicture(data.photo);
    }
  }

  private async pushUpdate(input: IUpdateMessage): Promise<void> {
    const topic = this.kafkaServiceQueueService.updateMessage();
    await this.streamProducerService.send(topic, input);
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
