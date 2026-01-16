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
import { ChatUserViewerRepository } from '@core/repositories/chat/ChatUserViewer.repository';

@injectable()
export class ChatListerUseCase {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly chatUserViewerRepository: ChatUserViewerRepository
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

  private async getUserSortPreferences(userId: string): Promise<{
    sortByChatOrder: string | null;
    sortInChatOrder: string | null;
    sortByMyChatsOrder: string | null;
    sortMyChatsOrder: string | null;
    sortByQueueOrder: string | null;
    sortQueueOrder: string | null;
    sortByChatbotOrder: string | null;
    sortChatbotOrder: string | null;
  }> {
    const chatUser = await this.chatUserViewerRepository.viewChatUser(userId);

    if (!chatUser) {
      return {
        sortByChatOrder: null,
        sortInChatOrder: null,
        sortByMyChatsOrder: null,
        sortMyChatsOrder: null,
        sortByQueueOrder: null,
        sortQueueOrder: null,
        sortByChatbotOrder: null,
        sortChatbotOrder: null,
      };
    }

    return {
      sortByChatOrder: chatUser.sort_by_chat_order ?? null,
      sortInChatOrder: chatUser.sort_in_chat_order ?? null,
      sortByMyChatsOrder: chatUser.sort_by_my_chats_order ?? null,
      sortMyChatsOrder: chatUser.sort_my_chats_order ?? null,
      sortByQueueOrder: chatUser.sort_by_queue_order ?? null,
      sortQueueOrder: chatUser.sort_queue_order ?? null,
      sortByChatbotOrder: chatUser.sort_by_chatbot_order ?? null,
      sortChatbotOrder: chatUser.sort_chatbot_order ?? null,
    };
  }

  private getSortForStatus(
    status: string | string[],
    filterStatus: string | null | undefined,
    preferences: {
      sortByChatOrder: string | null;
      sortInChatOrder: string | null;
      sortByMyChatsOrder: string | null;
      sortMyChatsOrder: string | null;
      sortByQueueOrder: string | null;
      sortQueueOrder: string | null;
      sortByChatbotOrder: string | null;
      sortChatbotOrder: string | null;
    }
  ): { sortBy: string; sortOrder: string } {
    const isAll = filterStatus === null || filterStatus === undefined;
    const statusArray = Array.isArray(status) ? status : [status];
    const effectiveStatus =
      filterStatus ?? (statusArray.length === 1 ? statusArray[0] : null);

    if (isAll && statusArray.length > 1) {
      if (preferences.sortByChatOrder && preferences.sortInChatOrder) {
        return {
          sortBy: preferences.sortByChatOrder,
          sortOrder: preferences.sortInChatOrder,
        };
      }
    }

    if (effectiveStatus === EChatStatus.in_chat) {
      if (preferences.sortByMyChatsOrder && preferences.sortMyChatsOrder) {
        return {
          sortBy: preferences.sortByMyChatsOrder,
          sortOrder: preferences.sortMyChatsOrder,
        };
      }
    }

    if (effectiveStatus === EChatStatus.queue) {
      if (preferences.sortByQueueOrder && preferences.sortQueueOrder) {
        return {
          sortBy: preferences.sortByQueueOrder,
          sortOrder: preferences.sortQueueOrder,
        };
      }
    }

    return {
      sortBy: 'date',
      sortOrder: 'desc',
    };
  }

  private getSortField(field: string): string {
    const fieldMap: Record<string, string> = {
      'summary.last_message': 'summary.last_date',
      'account.name': 'account.name.keyword',
      'worker.name': 'worker.name.keyword',
      name: 'name.keyword',
      phone: 'phone.keyword',
      status: 'status',
      date: 'date',
      'user.name': 'user.name.keyword',
      'sector.name': 'sector.name.keyword',
      started_at: 'started_at',
      closed_at: 'closed_at',
    };
    return fieldMap[field] || 'date';
  }

  private buildElasticsearchSort(sortBy: string, sortOrder: string): any[] {
    const field = this.getSortField(sortBy);

    if (field === 'account.name.keyword') {
      return [
        {
          'account.name.keyword': {
            order: sortOrder,
            nested: {
              path: 'account',
            },
          },
        },
      ];
    }

    if (field === 'worker.name.keyword') {
      return [
        {
          'worker.name.keyword': {
            order: sortOrder,
            nested: {
              path: 'worker',
            },
          },
        },
      ];
    }

    if (field === 'user.name.keyword') {
      return [
        {
          'user.name.keyword': {
            order: sortOrder,
            nested: {
              path: 'user',
            },
          },
        },
      ];
    }

    if (field === 'sector.name.keyword') {
      return [
        {
          'sector.name.keyword': {
            order: sortOrder,
            nested: {
              path: 'sector',
            },
          },
        },
      ];
    }

    if (field === 'summary.last_date') {
      return [
        {
          'summary.last_date': {
            order: sortOrder,
            nested: {
              path: 'summary',
            },
          },
        },
      ];
    }

    return [{ [field]: { order: sortOrder } }];
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
      const statusArray = Array.isArray(query.status)
        ? query.status
        : [query.status];

      if (statusArray.length === 1) {
        filterClauses.push({
          term: {
            status: statusArray[0],
          },
        });
      } else {
        filterClauses.push({
          terms: {
            status: statusArray,
          },
        } as unknown as IElasticsearchBoolClause);
      }
    }

    if (query.filter_label_template_id) {
      filterClauses.push({
        nested: {
          path: 'label',
          query: {
            term: {
              'label.label_template_id': query.filter_label_template_id,
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

    if (
      query.filter_sector_id &&
      this.canListAllChatsWithoutSectorLimit(actions)
    ) {
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
      const statusArray = Array.isArray(query.status)
        ? query.status
        : [query.status];

      if (statusArray.includes(EChatStatus.in_chat)) {
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

      if (statusArray.includes(EChatStatus.queue)) {
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

    const userPreferences = await this.getUserSortPreferences(userId);
    const { sortBy, sortOrder } = this.getSortForStatus(
      query.status,
      query.filter_status,
      userPreferences
    );
    const sort = this.buildElasticsearchSort(sortBy, sortOrder);

    const queryElastic = {
      from: (currentPage - 1) * perPage,
      size: perPage,
      sort,
      query: {
        bool: {
          must: mustClauses,
          filter: filterClauses,
        },
      },
      aggs: {
        status_counts: {
          terms: {
            field: 'status',
            size: 20,
          },
        },
      },
    };

    const buildQueueCountFilter = (): IElasticsearchBoolClause[] => {
      const baseFilters = filterClauses.filter(
        (clause) => !(clause as any).term?.status
      );

      if (hasPermissionToViewAll) {
        return [
          ...baseFilters,
          {
            term: {
              status: EChatStatus.queue,
            },
          } as unknown as IElasticsearchBoolClause,
        ];
      }

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

      return [
        ...baseFilters,
        {
          term: {
            status: EChatStatus.queue,
          },
        } as unknown as IElasticsearchBoolClause,
        queueVisibility,
      ];
    };

    const buildInChatCountFilter = (): IElasticsearchBoolClause[] => {
      const baseFilters = filterClauses.filter(
        (clause) => !(clause as any).term?.status
      );

      if (hasPermissionToViewAll) {
        return [
          ...baseFilters,
          {
            term: {
              status: EChatStatus.in_chat,
            },
          } as unknown as IElasticsearchBoolClause,
        ];
      }

      return [
        ...baseFilters,
        {
          term: {
            status: EChatStatus.in_chat,
          },
        } as unknown as IElasticsearchBoolClause,
        {
          nested: {
            path: 'user',
            query: {
              term: {
                'user.id': userId,
              },
            },
          },
        } as unknown as IElasticsearchBoolClause,
      ];
    };

    const buildChatbotCountFilter = (): IElasticsearchBoolClause[] => {
      const baseFilters = filterClauses.filter(
        (clause) => !(clause as any).term?.status
      );

      const canViewChatbotMessages = hasRequiredPermission(actions, [
        EGeneralPermissions.full_access,
        EGeneralPermissions.full_access_group,
        EChatPermissions.chat_group,
        EChatPermissions.view_chatbot_messages,
      ]);

      if (canViewChatbotMessages) {
        return [
          ...baseFilters,
          {
            term: {
              status: EChatStatus.ura,
            },
          } as unknown as IElasticsearchBoolClause,
        ];
      }

      return [
        ...baseFilters,
        {
          term: {
            status: EChatStatus.ura,
          },
        } as unknown as IElasticsearchBoolClause,
        {
          nested: {
            path: 'user',
            query: {
              term: {
                'user.id': userId,
              },
            },
          },
        } as unknown as IElasticsearchBoolClause,
      ];
    };

    const buildMyChatsCountFilter = (): IElasticsearchBoolClause[] => {
      const baseFilters = filterClauses.filter(
        (clause) => !(clause as any).term?.status
      );

      return [
        ...baseFilters,
        {
          terms: {
            status: [EChatStatus.queue, EChatStatus.in_chat],
          },
        } as unknown as IElasticsearchBoolClause,
        {
          nested: {
            path: 'user',
            query: {
              term: {
                'user.id': userId,
              },
            },
          },
        } as unknown as IElasticsearchBoolClause,
      ];
    };

    const queueCountQuery: any = {
      size: 0,
      query: {
        bool: {
          must: mustClauses,
          filter: buildQueueCountFilter(),
        },
      },
    };

    const inChatCountQuery: any = {
      size: 0,
      query: {
        bool: {
          must: mustClauses,
          filter: buildInChatCountFilter(),
        },
      },
    };

    const chatbotCountQuery: any = {
      size: 0,
      query: {
        bool: {
          must: mustClauses,
          filter: buildChatbotCountFilter(),
        },
      },
    };

    const myChatsCountQuery: any = {
      size: 0,
      query: {
        bool: {
          must: mustClauses,
          filter: buildMyChatsCountFilter(),
        },
      },
    };

    const [
      result,
      queueCountResult,
      inChatCountResult,
      chatbotCountResult,
      myChatsCountResult,
    ] = await Promise.all([
      this.elasticDatabaseService.select(EElasticIndex.chat, queryElastic),
      this.elasticDatabaseService.select(EElasticIndex.chat, queueCountQuery),
      this.elasticDatabaseService.select(EElasticIndex.chat, inChatCountQuery),
      this.elasticDatabaseService.select(EElasticIndex.chat, chatbotCountQuery),
      this.elasticDatabaseService.select(EElasticIndex.chat, myChatsCountQuery),
    ]);

    if (!result) {
      const pagings = setPaginationData(0, 0, perPage, currentPage);

      return {
        pagings,
        results: [],
        counts: {
          queue: 0,
          in_chat: 0,
          chatbot: 0,
          my_chats: 0,
        },
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

    const queueTotal =
      (queueCountResult?.hits?.total as { value: number })?.value || 0;
    const inChatTotal =
      (inChatCountResult?.hits?.total as { value: number })?.value || 0;
    const chatbotTotal =
      (chatbotCountResult?.hits?.total as { value: number })?.value || 0;
    const myChatsTotal =
      (myChatsCountResult?.hits?.total as { value: number })?.value || 0;

    return {
      pagings,
      results: chats,
      counts: {
        queue: queueTotal,
        in_chat: inChatTotal,
        chatbot: chatbotTotal,
        my_chats: myChatsTotal,
      },
    };
  }
}
