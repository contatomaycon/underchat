import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import {
  ListMessageChatsParams,
  ListMessageChatsQuery,
} from '@core/schema/chat/listMessageChats/request.schema';
import { ListMessageResponse } from '@core/schema/chat/listMessageChats/response.schema';
import { IChat } from '@core/common/interfaces/IChat';

@injectable()
export class ChatMessageListerUseCase {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  private async updateChat(chatId: string) {
    const input: IChat['summary'] = {
      last_message: null,
      last_date: new Date().toISOString(),
      unread_count: 0,
    };
    return this.elasticDatabaseService.update(
      EElasticIndex.chat,
      { summary: input },
      chatId
    );
  }

  private async getChatMessage(
    accountId: string,
    query: ListMessageChatsQuery,
    params: ListMessageChatsParams
  ): Promise<ListMessageResponse[]> {
    const from = query.from ?? 0;
    const size = query.size ?? 100;

    const queryElastic = {
      from,
      size,
      sort: [{ date: { order: 'asc' } }],
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
          ],
          filter: [
            {
              term: {
                chat_id: params.chat_id,
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.message,
      queryElastic
    );

    if (!result) {
      return [];
    }

    return result.hits.hits.map((hit) => hit._source) as ListMessageResponse[];
  }

  async execute(
    accountId: string,
    query: ListMessageChatsQuery,
    params: ListMessageChatsParams
  ): Promise<ListMessageResponse[]> {
    const chatMessages = await this.getChatMessage(accountId, query, params);

    if (!chatMessages) {
      return [] as ListMessageResponse[];
    }

    await this.updateChat(params.chat_id);

    return chatMessages;
  }
}
