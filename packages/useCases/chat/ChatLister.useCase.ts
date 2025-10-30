import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import {
  ListChatsResponse,
  ListChatsResult,
} from '@core/schema/chat/listChats/response.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';

@injectable()
export class ChatListerUseCase {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  async execute(
    accountId: string,
    query: ListChatsQuery
  ): Promise<ListChatsResponse> {
    const currentPage = query.current_page ?? 1;
    const perPage = query.per_page ?? 10;

    const queryElastic = {
      from: (currentPage - 1) * perPage,
      size: perPage,
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
      const pagings = setPaginationData(0, 0, perPage, currentPage);

      return {
        pagings,
        results: [],
      };
    }

    const chats = result.hits.hits.map(
      (hit) => hit._source
    ) as ListChatsResult[];
    const total = result.hits.total as { value: number; relation: string };

    const pagings = setPaginationData(
      chats.length,
      total.value,
      perPage,
      currentPage
    );

    return {
      pagings,
      results: chats,
    };
  }
}
