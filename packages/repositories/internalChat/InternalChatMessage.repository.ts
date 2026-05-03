import { injectable, inject } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { internalChatMessageMappings } from '@core/mappings/internalChatMessage.mappings';
import { IInternalChatMessage } from '@core/common/interfaces/internalChat/IInternalChatMessage';
import {
  IInternalChatListMessagesInput,
  IInternalChatListMessagesResult,
  IInternalChatSearchMessagesInput,
  IInternalChatSearchMessagesResult,
  IInternalChatSaveMessageResult,
} from '@core/common/interfaces/internalChat/IInternalChatMessageRepositoryContracts';
import { EMessageType } from '@core/common/enums/EMessageType';

@injectable()
export class InternalChatMessageRepository {
  private isIndexEnsured = false;
  private ensureIndexPromise: Promise<void> | null = null;

  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  async ensureIndex(): Promise<void> {
    if (this.isIndexEnsured) {
      return;
    }

    if (!this.ensureIndexPromise) {
      this.ensureIndexPromise = this.elasticDatabaseService
        .indices(
          EElasticIndex.internal_chat_message,
          internalChatMessageMappings()
        )
        .then(() => {
          this.isIndexEnsured = true;
        })
        .finally(() => {
          this.ensureIndexPromise = null;
        });
    }

    await this.ensureIndexPromise;
  }

  async saveMessage(
    message: IInternalChatMessage
  ): Promise<IInternalChatSaveMessageResult> {
    await this.ensureIndex();

    const result = await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.internal_chat_message,
      message.message_id,
      message as unknown as Record<string, unknown>,
      {
        upsert: true,
        maxRetries: 5,
      }
    );

    return {
      created: result === 'created',
    };
  }

  async getMessageById(
    accountId: string,
    conversationId: string,
    messageId: string
  ): Promise<IInternalChatMessage | null> {
    await this.ensureIndex();

    const query = {
      size: 1,
      query: {
        bool: {
          filter: [
            { term: { message_id: messageId } },
            { term: { conversation_id: conversationId } },
            { term: { account_id: accountId } },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.internal_chat_message,
      query
    );

    const hit = result?.hits?.hits?.[0]?._source as IInternalChatMessage | null;
    return hit ?? null;
  }

  async listMessages(
    input: IInternalChatListMessagesInput
  ): Promise<IInternalChatListMessagesResult> {
    await this.ensureIndex();

    const query = {
      from: (input.currentPage - 1) * input.perPage,
      size: input.perPage,
      sort: [{ date: { order: 'desc' } }],
      query: {
        bool: {
          filter: [
            { term: { account_id: input.accountId } },
            { term: { conversation_id: input.conversationId } },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.internal_chat_message,
      query
    );

    const total =
      ((result?.hits?.total as { value?: number } | undefined)?.value ?? 0) ||
      0;

    const docs = (result?.hits?.hits ?? []).map(
      (hit) => hit._source as IInternalChatMessage
    );

    return {
      results: docs,
      total,
    };
  }

  async searchMessages(
    input: IInternalChatSearchMessagesInput
  ): Promise<IInternalChatSearchMessagesResult> {
    await this.ensureIndex();

    const query = {
      from: (input.currentPage - 1) * input.perPage,
      size: input.perPage,
      sort: [{ date: { order: 'desc' } }],
      query: {
        bool: {
          filter: [
            { term: { account_id: input.accountId } },
            { term: { conversation_id: input.conversationId } },
          ],
          must: [
            {
              nested: {
                path: 'content',
                query: {
                  bool: {
                    must: [
                      {
                        match: {
                          'content.message': {
                            query: input.search,
                            operator: 'and',
                          },
                        },
                      },
                    ],
                    must_not: [
                      { term: { 'content.type': EMessageType.delete_message } },
                      { term: { 'content.type': EMessageType.system } },
                    ],
                  },
                },
              },
            },
          ],
          must_not: [{ term: { deleted: true } }],
        },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.internal_chat_message,
      query
    );

    const total =
      ((result?.hits?.total as { value?: number } | undefined)?.value ?? 0) ||
      0;

    const docs = (result?.hits?.hits ?? []).map(
      (hit) => hit._source as IInternalChatMessage
    );

    return {
      results: docs,
      total,
    };
  }

  async updateMessage(message: IInternalChatMessage): Promise<boolean> {
    await this.ensureIndex();

    const result = await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.internal_chat_message,
      message.message_id,
      message as unknown as Record<string, unknown>,
      {
        upsert: false,
        maxRetries: 5,
      }
    );

    return result === 'updated' || result === 'noop';
  }
}
