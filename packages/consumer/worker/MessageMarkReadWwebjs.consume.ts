import { singleton, inject } from 'tsyringe';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IMessageMarkRead } from '@core/common/interfaces/IMessageMarkRead';
import { WwebjsIncomingMessageService } from '@core/services/wwebjs/methods/incoming.service';
import { wwebjsEnvironment } from '@core/config/environments';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { MessageStatusService } from '@core/services/messageStatus.service';
import Redis from 'ioredis';
import type { IWhatsappRuntimeFence } from '@core/services/whatsappRuntimeFence.service';
import { ensureMessageStatusEventId } from '@core/common/functions/messageStatusIdentity';

@singleton()
export class MessageMarkReadWwebjsConsume {
  constructor(
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(WwebjsIncomingMessageService)
    private readonly wwebjsIncomingMessageService: WwebjsIncomingMessageService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private parseMessage(value: Buffer | null): IMessageMarkRead | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IMessageMarkRead;
      return parsed ?? null;
    } catch {
      return null;
    }
  }

  public async handleJetStreamCommand(
    payload: unknown,
    assertActive: () => void
  ): Promise<void> {
    const data = this.parseMessage(
      Buffer.from(JSON.stringify(payload), 'utf8')
    );
    if (!data) throw new Error('worker_command_mark_read_payload_invalid');
    await this.processMarkRead(data, { assertActive });
  }

  private async isMarkAsReadEnabled(workerId: string): Promise<boolean> {
    try {
      const cacheKey = `worker:${workerId}:mark_as_read`;
      const cached = await this.redis.get(cacheKey);
      return cached === 'true';
    } catch {
      return false;
    }
  }

  private connectionScopesMatch(
    expected: IWhatsappRuntimeFence,
    current: IWhatsappRuntimeFence | null
  ): boolean {
    return (
      current !== null &&
      current.worker_id === expected.worker_id &&
      current.runtime_generation === expected.runtime_generation &&
      current.connection_epoch === expected.connection_epoch &&
      current.source_provider === expected.source_provider
    );
  }

  private async processMarkRead(
    data: IMessageMarkRead,
    context: { assertActive: () => void }
  ): Promise<void> {
    if (data.worker_id !== wwebjsEnvironment.wwebjsWorkerId) {
      return;
    }

    const isEnabled = await this.isMarkAsReadEnabled(data.worker_id);
    if (!isEnabled) {
      return;
    }

    const connectionScope =
      await this.wwebjsIncomingMessageService.captureActiveConnectionScope();
    if (
      !connectionScope ||
      connectionScope.worker_id !== data.worker_id ||
      connectionScope.source_provider !== 'wwebjs'
    ) {
      return;
    }

    context.assertActive();
    const currentScope =
      await this.wwebjsIncomingMessageService.captureActiveConnectionScope();
    context.assertActive();
    if (!this.connectionScopesMatch(connectionScope, currentScope)) {
      return;
    }
    await this.wwebjsIncomingMessageService.markRead(
      data.keys as Array<{
        remoteJid?: string | null;
        remote_jid?: string | null;
        id?: string;
      }>
    );

    context.assertActive();
    const publishScope =
      await this.wwebjsIncomingMessageService.captureActiveConnectionScope();
    context.assertActive();
    if (!this.connectionScopesMatch(connectionScope, publishScope)) {
      return;
    }

    await Promise.all(
      data.keys.map(async (key) => {
        if (!key.id) return;

        const statusUpdate: IMessageStatusUpdate = {
          account_id: data.account_id,
          worker_id: connectionScope.worker_id,
          source_provider: connectionScope.source_provider,
          runtime_generation: connectionScope.runtime_generation,
          connection_epoch: connectionScope.connection_epoch,
          message_id: key.id,
          patch: { is_seen: true },
          key,
        };
        ensureMessageStatusEventId(statusUpdate);

        const kafkaKey = MessageStatusService.statusKafkaKey(
          data.account_id,
          key.id,
          connectionScope.worker_id
        );

        context.assertActive();
        await this.streamProducerService.send(
          this.kafkaServiceQueueService.updateMessageStatus(),
          statusUpdate,
          kafkaKey,
          undefined,
          context.assertActive
        );
      })
    );
  }
}
