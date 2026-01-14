import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { CentrifugoService } from './centrifugo.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import {
  MessageSummaryBaseline,
  MessageSummaryScriptParams,
} from '@core/common/interfaces/IMessageSummaryUpdate';

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

    const message = await this.findMessageByWhatsAppIdWithRetry(
      accountId,
      messageId
    );
    if (!message?.message_id) {
      return null;
    }

    const updated = await this.updateSummaryAtomicallyWithRetry(
      message.message_id,
      message.summary,
      patch
    );

    if (!updated) {
      return null;
    }

    const updatedMessage: IChatMessage = {
      ...message,
      summary: this.mergeSummary(message.summary, patch) ?? message.summary,
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

  private async findMessageByWhatsAppIdWithRetry(
    accountId: string,
    messageId: string,
    maxRetries = 5
  ): Promise<IChatMessage | null> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const message = await this.findMessageByWhatsAppId(accountId, messageId);
      if (message?.message_id) {
        return message;
      }

      if (attempt < maxRetries - 1) {
        const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    return null;
  }

  private async updateSummaryAtomicallyWithRetry(
    messageId: string,
    currentSummary: IChatMessage['summary'],
    patch: MessageSummaryPatch,
    maxRetries = 5
  ): Promise<boolean> {
    return this.attemptUpdateWithRetry(
      messageId,
      currentSummary,
      patch,
      0,
      maxRetries
    );
  }

  private async attemptUpdateWithRetry(
    messageId: string,
    summary: IChatMessage['summary'],
    patch: MessageSummaryPatch,
    attempt: number,
    maxRetries: number
  ): Promise<boolean> {
    if (attempt >= maxRetries) {
      return false;
    }

    const updated = await this.updateSummaryAtomically(
      messageId,
      summary,
      patch
    );
    if (updated) {
      return true;
    }

    if (attempt >= maxRetries - 1) {
      return false;
    }

    const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));

    const refreshedMessage = await this.findMessageByMessageId(messageId);
    const nextSummary = refreshedMessage?.summary ?? summary;

    return this.attemptUpdateWithRetry(
      messageId,
      nextSummary,
      patch,
      attempt + 1,
      maxRetries
    );
  }

  private async findMessageByMessageId(
    messageId: string
  ): Promise<IChatMessage | null> {
    const queryElastic = {
      size: 1,
      query: {
        term: { message_id: messageId },
      },
    };

    const result = await this.elasticDatabaseService.select<IChatMessage>(
      EElasticIndex.message,
      queryElastic
    );

    const hit = result?.hits?.hits?.[0] as ElasticHit<IChatMessage> | undefined;
    return hit?._source ?? null;
  }

  private buildMessageSummaryBaseline(
    currentSummary: IChatMessage['summary'] | null | undefined
  ): MessageSummaryBaseline {
    return {
      is_sent: currentSummary?.is_sent ?? false,
      is_delivered: currentSummary?.is_delivered ?? false,
      is_seen: currentSummary?.is_seen ?? false,
      is_sent_to_internal: currentSummary?.is_sent_to_internal ?? false,
    };
  }

  private buildMessageSummaryScriptParams(
    baseline: MessageSummaryBaseline,
    patch: MessageSummaryPatch
  ): MessageSummaryScriptParams {
    return {
      baseline,
      patch_is_sent: patch.is_sent ?? null,
      patch_is_delivered: patch.is_delivered ?? null,
      patch_is_seen: patch.is_seen ?? null,
    };
  }

  private buildMessageSummaryScriptSource(): string {
    return `
      if (ctx._source.summary == null) {
        ctx._source.summary = params.baseline;
      }
      
      def summary = ctx._source.summary;
      def changed = false;
      
      if (params.patch_is_sent != null && params.patch_is_sent) {
        if (!summary.containsKey('is_sent') || !summary.is_sent) {
          summary.is_sent = true;
          changed = true;
        }
      }
      
      if (params.patch_is_delivered != null && params.patch_is_delivered) {
        if (!summary.containsKey('is_delivered') || !summary.is_delivered) {
          summary.is_delivered = true;
          changed = true;
        }
      }
      
      if (params.patch_is_seen != null && params.patch_is_seen) {
        if (!summary.containsKey('is_seen') || !summary.is_seen) {
          summary.is_seen = true;
          changed = true;
        }
      }
      
      if (!summary.containsKey('is_sent_to_internal')) {
        summary.is_sent_to_internal = params.baseline.is_sent_to_internal;
      }
      
      if (!changed) {
        ctx.op = 'noop';
      }
    `;
  }

  private async updateSummaryAtomically(
    messageId: string,
    currentSummary: IChatMessage['summary'],
    patch: MessageSummaryPatch
  ): Promise<boolean> {
    const baseline = this.buildMessageSummaryBaseline(currentSummary);
    const scriptParams = this.buildMessageSummaryScriptParams(baseline, patch);
    const scriptSource = this.buildMessageSummaryScriptSource();

    try {
      const result = await this.elasticDatabaseService.updateWithScript(
        EElasticIndex.message,
        messageId,
        {
          source: scriptSource,
          params: scriptParams,
        },
        {
          retry_on_conflict: 10,
          upsert: {
            summary: baseline,
          },
        }
      );

      return result === 'updated' || result === 'created' || result === 'noop';
    } catch {
      return false;
    }
  }
}
