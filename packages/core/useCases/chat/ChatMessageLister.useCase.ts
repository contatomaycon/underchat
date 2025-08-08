import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import {
  ListMessageChatsParams,
  ListMessageChatsQuery,
} from '@core/schema/chat/listMessageChats/request.schema';
import { ListMessageResponse } from '@core/schema/chat/listMessageChats/response.schema';

@injectable()
export class ChatMessageListerUseCase {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  async execute(
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
}
