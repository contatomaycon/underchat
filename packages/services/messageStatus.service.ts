import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { CentrifugoService } from './centrifugo.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';

export type MessageSummaryPatch = Partial<
  Pick<IChatMessage['summary'], 'is_sent' | 'is_delivered' | 'is_seen'>
>;

type ElasticHit<T> = {
  _source?: T;
};

@injectable()
export class MessageStatusService {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly centrifugoService: CentrifugoService
  ) {}

  async updateSummaryByWhatsAppId(
    accountId: string,
    messageId: string,
    patch: MessageSummaryPatch
  ): Promise<IChatMessage | null> {
    if (!messageId || !accountId || !this.hasPatch(patch)) {
      return null;
    }

    const message = await this.findMessageByWhatsAppId(accountId, messageId);
    if (!message?.message_id) {
      return null;
    }

    const mergedSummary = this.mergeSummary(message.summary, patch);
    if (!mergedSummary) {
      return null;
    }

    await this.elasticDatabaseService.update(
      EElasticIndex.message,
      { summary: mergedSummary },
      message.message_id
    );

    const updatedMessage: IChatMessage = {
      ...message,
      summary: mergedSummary,
    };

    const channelAccountId = updatedMessage.account?.id ?? accountId;
    await this.centrifugoService.publishSub(
      chatAccountCentrifugo(channelAccountId),
      updatedMessage
    );

    return updatedMessage;
  }

  private hasPatch(patch: MessageSummaryPatch): boolean {
    return Boolean(
      patch &&
      (patch.is_sent !== undefined ||
        patch.is_delivered !== undefined ||
        patch.is_seen !== undefined)
    );
  }

  private mergeSummary(
    current: IChatMessage['summary'],
    patch: MessageSummaryPatch
  ): IChatMessage['summary'] | null {
    const baseline: IChatMessage['summary'] = {
      is_sent: current?.is_sent ?? false,
      is_delivered: current?.is_delivered ?? false,
      is_seen: current?.is_seen ?? false,
      is_sent_to_internal: current?.is_sent_to_internal ?? false,
    };

    let changed = false;
    const next = { ...baseline };

    if (patch.is_sent && !next.is_sent) {
      next.is_sent = true;
      changed = true;
    }

    if (patch.is_delivered && !next.is_delivered) {
      next.is_delivered = true;
      changed = true;
    }

    if (patch.is_seen && !next.is_seen) {
      next.is_seen = true;
      changed = true;
    }

    return changed ? next : null;
  }

  private async findMessageByWhatsAppId(
    accountId: string,
    messageId: string
  ): Promise<IChatMessage | null> {
    const queryElastic = {
      size: 1,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: { 'account.id': accountId },
                },
              },
            },
            {
              nested: {
                path: 'message_key',
                query: {
                  term: { 'message_key.id': messageId },
                },
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<IChatMessage>(
      EElasticIndex.message,
      queryElastic
    );

    const hit = result?.hits?.hits?.[0] as ElasticHit<IChatMessage> | undefined;
    return hit?._source ?? null;
  }
}
