import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import {
  ListChatsResponse,
  ListChatsResult,
} from '@core/schema/chat/listChats/response.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { IElasticsearchBoolClause } from '@core/common/interfaces/IElasticsearchQuery';

@injectable()
export class ChatListerUseCase {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  private canViewOthersChats(actions: IJwtGroupHierarchy[]): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.view_others_chats,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private canListAllChatsWithoutSectorLimit(
    actions: IJwtGroupHierarchy[]
  ): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.list_all_chats_without_sector_limit,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  async execute(
    accountId: string,
    query: ListChatsQuery,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[]
  ): Promise<ListChatsResponse> {
    const currentPage = query.current_page ?? 1;
    const perPage = query.per_page ?? 10;

    const mustClauses: IElasticsearchBoolClause[] = [
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
    ];

    const filterClauses: IElasticsearchBoolClause[] = [
      {
        term: {
          status: query.status,
        },
      },
    ];

    if (!this.canViewOthersChats(actions)) {
      if (query.status === EChatStatus.in_chat) {
        filterClauses.push({
          nested: {
            path: 'user',
            query: {
              term: {
                'user.id': userId,
              },
            },
          },
        });
      }
    }

    if (!this.canListAllChatsWithoutSectorLimit(actions)) {
      const sectorFilterClauses: IElasticsearchBoolClause[] = [];

      if (userSectors.length > 0) {
        sectorFilterClauses.push({
          nested: {
            path: 'sector',
            query: {
              terms: {
                'sector.id': userSectors,
              },
            },
          },
        } as unknown as IElasticsearchBoolClause);
      }
      if (userSectors.length === 0) {
        sectorFilterClauses.push({
          bool: {
            must_not: {
              exists: {
                field: 'sector',
              },
            },
          },
        } as unknown as IElasticsearchBoolClause);
      }

      const shouldClauses: IElasticsearchBoolClause[] = [
        {
          nested: {
            path: 'user',
            query: {
              term: {
                'user.id': userId,
              },
            },
          },
        },
        ...sectorFilterClauses,
      ];

      if (query.status === EChatStatus.queue) {
        shouldClauses.push({
          bool: {
            must: [
              {
                bool: {
                  must_not: {
                    exists: {
                      field: 'sector',
                    },
                  },
                },
              },
              {
                bool: {
                  must_not: {
                    exists: {
                      field: 'user',
                    },
                  },
                },
              },
            ],
          },
        } as unknown as IElasticsearchBoolClause);
      }

      filterClauses.push({
        bool: {
          should: shouldClauses,
          minimum_should_match: 1,
        },
      } as unknown as IElasticsearchBoolClause);
    }

    const queryElastic = {
      from: (currentPage - 1) * perPage,
      size: perPage,
      sort: [{ date: { order: 'desc' } }],
      query: {
        bool: {
          must: mustClauses,
          filter: filterClauses,
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

    const chats = result.hits.hits.map((hit) => {
      const source = hit._source as ListChatsResult;
      if (!source.chat_id && hit._id) {
        source.chat_id = hit._id;
      }
      return source;
    }) as ListChatsResult[];
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
