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
import { remoteJid } from '@core/common/functions/remoteJid';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { WAMessageKey } from '@whiskeysockets/baileys';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { createChatCacheKeyChatId } from '@core/common/functions/createCacheKey';
import { MessageKeyUpdateScriptParams } from '@core/common/interfaces/IMessageKeyUpdateScript';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';
import { MessageStatusPendingService } from '@core/services/messageStatusPending.service';

type MessageKeyPatch = Pick<
  IMessageKey,
  'remote_jid' | 'id' | 'from_me' | 'participant' | 'is_view_once'
>;

@singleton()
export class MessageUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private partitionChains: Map<number, Promise<void>> = new Map();

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(MessageStatusPendingService)
    private readonly messageStatusPendingService: MessageStatusPendingService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
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

      return parsed ?? null;
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
    data: IUpdateMessage
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

    await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.chat,
      chatId,
      {
        source: scriptSource,
        params: scriptParams,
      },
      {
        maxRetries: 5,
      }
    );

    const cacheKey = this.cacheChatKey(data.data?.account?.id ?? '', chatId);

    await this.redis.del(cacheKey);
  }

  private async updateMessageIfMissingKey(data: IUpdateMessage): Promise<void> {
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

    const scriptSource = this.buildMessageKeyUpdateScriptSource();
    const scriptParams = this.buildMessageKeyUpdateScriptParams(patch);

    await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.message,
      messageId,
      {
        source: scriptSource,
        params: scriptParams,
      },
      {
        maxRetries: 5,
      }
    );
  }

  private async publishPendingStatusForPatchedKey(
    data: IUpdateMessage
  ): Promise<void> {
    const accountId = data.data?.account?.id;
    const internalMessageId = data.data?.message_id;
    const patch = this.buildMessageKeyPatch(data);
    const rawMessageKeyId = data.message?.key?.id?.trim();

    if (!accountId || !internalMessageId || !patch.id) {
      return;
    }

    const whatsAppMessageIds = Array.from(
      new Set([patch.id, rawMessageKeyId].filter(Boolean) as string[])
    );

    await Promise.all(
      whatsAppMessageIds.map((whatsAppMessageId) =>
        this.messageStatusPendingService.setInternalMessageIdAlias(
          accountId,
          whatsAppMessageId,
          internalMessageId
        )
      )
    );
    await Promise.all(
      whatsAppMessageIds.map((whatsAppMessageId) =>
        this.messageStatusPendingService.wakePendingStatus(
          accountId,
          whatsAppMessageId
        )
      )
    );
  }

  private async handleMessage(data: IUpdateMessage): Promise<void> {
    await this.updateChatIfMissingRemoteJid(data);
    await this.updateMessageIfMissingKey(data);
    await this.publishPendingStatusForPatchedKey(data);
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.updateMessage();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-message-update'
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);

      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const partition = message.partition;
      const offset = message.offset;

      const previousChain =
        this.partitionChains.get(partition) ?? Promise.resolve();

      const currentChain = previousChain.then(async () => {
        const heartbeat = async () => {
          this.consumer?.commit();
        };

        const stop = startHeartbeat(heartbeat);

        try {
          await this.handleMessage(data);
        } finally {
          stop();
          await this.commitNext(topic, partition, offset);
        }
      });

      this.partitionChains.set(partition, currentChain);
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
    await Promise.all(this.partitionChains.values());

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
      this.partitionChains.clear();
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }
}
