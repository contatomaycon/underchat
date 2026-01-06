import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { SearchChatsQuery } from '@core/schema/chat/searchChats/request.schema';
import { SearchChatsResponse } from '@core/schema/chat/searchChats/response.schema';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { IElasticsearchBoolClause } from '@core/common/interfaces/IElasticsearchQuery';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';

@injectable()
export class ChatSearcherUseCase {
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
    query: SearchChatsQuery,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[]
  ): Promise<SearchChatsResponse> {
    const currentPage = query.current_page ?? 1;
    const perPage = query.per_page ?? 10;
    const searchTerm = query.search.trim();

    if (!searchTerm) {
      const pagings = setPaginationData(0, 0, perPage, currentPage);
      return {
        pagings,
        results: [],
      };
    }

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
        terms: {
          status: [EChatStatus.queue, EChatStatus.in_chat],
        },
      } as unknown as IElasticsearchBoolClause,
    ];

    if (!this.canViewOthersChats(actions)) {
      filterClauses.push({
        bool: {
          should: [
            {
              term: {
                status: EChatStatus.queue,
              },
            },
            {
              bool: {
                must: [
                  {
                    term: {
                      status: EChatStatus.in_chat,
                    },
                  },
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
                ],
              },
            },
          ],
          minimum_should_match: 1,
        },
      } as unknown as IElasticsearchBoolClause);
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

      shouldClauses.push({
        bool: {
          must: [
            {
              term: {
                status: EChatStatus.queue,
              },
            },
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

      filterClauses.push({
        bool: {
          should: shouldClauses,
          minimum_should_match: 1,
        },
      } as unknown as IElasticsearchBoolClause);
    }

    const shouldClauses: any[] = [];

    shouldClauses.push(
      {
        wildcard: {
          'name.keyword': {
            value: `*${searchTerm.toLowerCase()}*`,
            case_insensitive: true,
          },
        },
      },
      {
        query_string: {
          default_field: 'name',
          query: `*${searchTerm}*`,
          analyze_wildcard: true,
          default_operator: 'OR',
        },
      },
      {
        nested: {
          path: 'contact',
          query: {
            wildcard: {
              'contact.name.keyword': {
                value: `*${searchTerm.toLowerCase()}*`,
                case_insensitive: true,
              },
            },
          },
        },
      },
      {
        nested: {
          path: 'contact',
          query: {
            query_string: {
              default_field: 'contact.name',
              query: `*${searchTerm}*`,
              analyze_wildcard: true,
              default_operator: 'OR',
            },
          },
        },
      }
    );

    const phoneCandidates = buildCandidates(searchTerm);
    if (phoneCandidates.length > 0) {
      shouldClauses.push(
        {
          terms: {
            phone: phoneCandidates,
          },
        },
        {
          nested: {
            path: 'contact',
            query: {
              terms: {
                'contact.phone': phoneCandidates,
              },
            },
          },
        }
      );
    }

    const phoneDigits = searchTerm.replaceAll(/\D/g, '');
    if (phoneDigits.length >= 3) {
      shouldClauses.push(
        {
          wildcard: {
            phone: {
              value: `*${phoneDigits}*`,
              case_insensitive: true,
            },
          },
        },
        {
          nested: {
            path: 'contact',
            query: {
              wildcard: {
                'contact.phone': {
                  value: `*${phoneDigits}*`,
                  case_insensitive: true,
                },
              },
            },
          },
        }
      );
    }

    const queryElastic: any = {
      from: (currentPage - 1) * perPage,
      size: perPage,
      sort: [{ date: { order: 'desc' } }],
      query: {
        bool: {
          must: [
            ...mustClauses,
            ...(shouldClauses.length > 0
              ? [
                  {
                    bool: {
                      should: shouldClauses,
                      minimum_should_match: 1,
                    },
                  },
                ]
              : []),
          ],
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
