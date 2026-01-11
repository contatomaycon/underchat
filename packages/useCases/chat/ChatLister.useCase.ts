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

    const filterClauses: IElasticsearchBoolClause[] = [];

    if (query.filter_status !== undefined && query.filter_status !== null) {
      filterClauses.push({
        term: {
          status: query.filter_status,
        },
      });
    } else if (query.filter_status === undefined) {
      filterClauses.push({
        term: {
          status: query.status,
        },
      });
    }

    if (query.filter_label_template_id) {
      filterClauses.push({
        nested: {
          path: 'label',
          query: {
            term: {
              'label.id': query.filter_label_template_id,
            },
          },
        },
      });
    }

    if (query.filter_worker_id) {
      filterClauses.push({
        nested: {
          path: 'worker',
          query: {
            term: {
              'worker.id': query.filter_worker_id,
            },
          },
        },
      });
    }

    if (query.filter_user_id) {
      filterClauses.push({
        nested: {
          path: 'user',
          query: {
            term: {
              'user.id': query.filter_user_id,
            },
          },
        },
      });
    }

    if (query.filter_sector_id) {
      filterClauses.push({
        nested: {
          path: 'sector',
          query: {
            term: {
              'sector.id': query.filter_sector_id,
            },
          },
        },
      });
    }

    if (query.filter_name) {
      filterClauses.push({
        bool: {
          should: [
            {
              wildcard: {
                'name.keyword': {
                  value: `*${query.filter_name.toLowerCase()}*`,
                  case_insensitive: true,
                },
              },
            },
            {
              query_string: {
                default_field: 'name',
                query: `*${query.filter_name}*`,
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
                      value: `*${query.filter_name.toLowerCase()}*`,
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
                    query: `*${query.filter_name}*`,
                    analyze_wildcard: true,
                    default_operator: 'OR',
                  },
                },
              },
            },
          ],
          minimum_should_match: 1,
        },
      } as unknown as IElasticsearchBoolClause);
    }

    if (query.filter_phone) {
      const phoneFilter = query.filter_phone.replace(/\D/g, '');
      if (phoneFilter.length > 0) {
        filterClauses.push({
          bool: {
            should: [
              {
                wildcard: {
                  phone: {
                    value: `*${phoneFilter}*`,
                    case_insensitive: true,
                  },
                },
              },
              {
                wildcard: {
                  'phone.keyword': {
                    value: `*${phoneFilter}*`,
                    case_insensitive: true,
                  },
                },
              },
              {
                nested: {
                  path: 'contact',
                  query: {
                    bool: {
                      should: [
                        {
                          wildcard: {
                            'contact.phone': {
                              value: `*${phoneFilter}*`,
                              case_insensitive: true,
                            },
                          },
                        },
                        {
                          wildcard: {
                            'contact.phone.keyword': {
                              value: `*${phoneFilter}*`,
                              case_insensitive: true,
                            },
                          },
                        },
                      ],
                      minimum_should_match: 1,
                    },
                  },
                },
              },
            ],
            minimum_should_match: 1,
          },
        } as unknown as IElasticsearchBoolClause);
      }
    }

    if (query.filter_protocol) {
      filterClauses.push({
        bool: {
          should: [
            {
              wildcard: {
                'protocol_ura.keyword': {
                  value: `*${query.filter_protocol.toLowerCase()}*`,
                  case_insensitive: true,
                },
              },
            },
            {
              wildcard: {
                'protocol_start.keyword': {
                  value: `*${query.filter_protocol.toLowerCase()}*`,
                  case_insensitive: true,
                },
              },
            },
            {
              wildcard: {
                'protocol_transfer.keyword': {
                  value: `*${query.filter_protocol.toLowerCase()}*`,
                  case_insensitive: true,
                },
              },
            },
          ],
          minimum_should_match: 1,
        },
      } as unknown as IElasticsearchBoolClause);
    }

    if (query.filter_date_start || query.filter_date_end) {
      const dateRange: Record<string, string> = {};
      if (query.filter_date_start) {
        dateRange.gte = query.filter_date_start;
      }
      if (query.filter_date_end) {
        dateRange.lte = query.filter_date_end;
      }
      filterClauses.push({
        range: {
          date: dateRange,
        },
      } as unknown as IElasticsearchBoolClause);
    }

    const canViewOthers = this.canViewOthersChats(actions);
    const canListAll = this.canListAllChatsWithoutSectorLimit(actions);

    const hasPermissionToViewAll = canViewOthers || canListAll;

    if (!hasPermissionToViewAll) {
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

      if (query.status === EChatStatus.queue) {
        const queueVisibility: IElasticsearchBoolClause = {
          bool: {
            should: [
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
              {
                bool: {
                  must: [
                    {
                      bool: {
                        must_not: {
                          nested: {
                            path: 'user',
                            query: {
                              exists: {
                                field: 'user.id',
                              },
                            },
                          },
                        },
                      },
                    },
                    userSectors.length > 0
                      ? ({
                          nested: {
                            path: 'sector',
                            query: {
                              terms: {
                                'sector.id': userSectors,
                              },
                            },
                          },
                        } as unknown as IElasticsearchBoolClause)
                      : ({
                          bool: {
                            must_not: {
                              nested: {
                                path: 'sector',
                                query: {
                                  exists: {
                                    field: 'sector.id',
                                  },
                                },
                              },
                            },
                          },
                        } as unknown as IElasticsearchBoolClause),
                  ],
                },
              } as unknown as IElasticsearchBoolClause,
            ],
            minimum_should_match: 1,
          },
        } as unknown as IElasticsearchBoolClause;

        filterClauses.push(queueVisibility);
      }
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
