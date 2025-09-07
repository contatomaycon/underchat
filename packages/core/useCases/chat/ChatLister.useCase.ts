import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import { ListChatsResponse } from '@core/schema/chat/listChats/response.schema';

@injectable()
export class ChatListerUseCase {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  async execute(
    accountId: string,
    query: ListChatsQuery
  ): Promise<ListChatsResponse[]> {
    const from = query.from ?? 0;
    const size = query.size ?? 100;

    const queryElastic = {
      from,
      size,
      sort: [{ date: { order: 'desc' } }],
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
                status: query.status,
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.chat,
      queryElastic
    );

    if (!result) {
      return [];
    }

    return result.hits.hits.map((hit) => hit._source) as ListChatsResponse[];
  }
}
