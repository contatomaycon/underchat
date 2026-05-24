import { injectable, inject } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { MY_CHATS_STATUS } from '@core/schema/chat/listChats/request.schema';
import { SearchChatsQuery } from '@core/schema/chat/searchChats/request.schema';
import { SearchChatsResponse } from '@core/schema/chat/searchChats/response.schema';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { IElasticsearchBoolClause } from '@core/common/interfaces/IElasticsearchQuery';
import { buildPhoneSearchClause } from '@core/common/functions/buildPhoneSearchClause';
import { ChatUserService } from '@core/services/chatUser.service';
import { extractUserChannelIds } from '@core/common/functions/extractUserChannelIds';

@injectable()
export class ChatSearcherUseCase {
  private readonly allowedSortByFields = new Set<string>([
    'summary.last_message',
    'account.name',
    'worker.name',
    'name',
    'phone',
    'status',
    'date',
    'user.name',
    'sector.name',
    'started_at',
    'closed_at',
  ]);

  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(ChatUserService)
    private readonly chatUserService: ChatUserService
  ) {}

  private sanitizeSort(
    sortBy: string | null | undefined,
    sortOrder: string | null | undefined
  ): { sortBy: string; sortOrder: 'asc' | 'desc' } {
    const normalizedSortBy =
      sortBy && this.allowedSortByFields.has(sortBy)
        ? sortBy
        : 'summary.last_message';

    const normalizedSortOrder =
      sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : 'desc';

    return {
      sortBy: normalizedSortBy,
      sortOrder: normalizedSortOrder,
    };
  }

  private canViewOthersChats(actions: IJwtGroupHierarchy[]): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private canViewChatsInSector(actions: IJwtGroupHierarchy[]): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.list_all_chats_in_sector,
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

  private canViewChatbotInputMessages(actions: IJwtGroupHierarchy[]): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.view_chatbot_messages,
      EChatbotPermissions.chatbot_group,
      EChatbotPermissions.chatbot_access,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private buildParticipantFilter(userId: string): IElasticsearchBoolClause {
    return {
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
            nested: {
              path: 'secondary_users',
              query: {
                term: {
                  'secondary_users.id': userId,
                },
              },
            },
          },
        ],
        minimum_should_match: 1,
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildParticipantExistsFilter(): IElasticsearchBoolClause {
    return {
      bool: {
        should: [
          {
            nested: {
              path: 'user',
              query: {
                exists: {
                  field: 'user.id',
                },
              },
            },
          },
          {
            nested: {
              path: 'secondary_users',
              query: {
                exists: {
                  field: 'secondary_users.id',
                },
              },
            },
          },
        ],
        minimum_should_match: 1,
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildNoParticipantFilter(): IElasticsearchBoolClause {
    return {
      bool: {
        must_not: [this.buildParticipantExistsFilter()],
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private hasChatAccessPermission(actions: IJwtGroupHierarchy[]): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.chat_access,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private buildNoSectorFilter(): IElasticsearchBoolClause {
    return {
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
    } as unknown as IElasticsearchBoolClause;
  }

  private buildSectorAccessFilter(
    userSectors: string[]
  ): IElasticsearchBoolClause {
    if (userSectors.length === 0) {
      return this.buildNoSectorFilter();
    }

    return {
      bool: {
        should: [
          {
            nested: {
              path: 'sector',
              query: {
                terms: {
                  'sector.id': userSectors,
                },
              },
            },
          },
          this.buildNoSectorFilter(),
        ],
        minimum_should_match: 1,
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildQueueSectorFilter(
    userSectors: string[],
    canViewInSector: boolean
  ): IElasticsearchBoolClause {
    if (userSectors.length === 0) {
      return this.buildNoSectorFilter();
    }

    if (canViewInSector) {
      return this.buildSectorAccessFilter(userSectors);
    }

    return {
      nested: {
        path: 'sector',
        query: {
          terms: {
            'sector.id': userSectors,
          },
        },
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildChatbotInputStatusFilter(): IElasticsearchBoolClause {
    return {
      term: {
        status: EChatStatus.ura,
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildStatusFilter(statuses: EChatStatus[]): IElasticsearchBoolClause {
    if (statuses.length === 1) {
      return {
        term: {
          status: statuses[0],
        },
      } as unknown as IElasticsearchBoolClause;
    }

    return {
      terms: {
        status: statuses,
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildMyChatsFilter(userId: string): IElasticsearchBoolClause {
    return {
      bool: {
        must: [
          {
            terms: {
              status: [EChatStatus.queue, EChatStatus.in_chat],
            },
          } as unknown as IElasticsearchBoolClause,
          this.buildParticipantFilter(userId),
        ],
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildQueueWithoutParticipantFilter(
    userSectors: string[],
    canViewInSector: boolean
  ): IElasticsearchBoolClause {
    return {
      bool: {
        must: [
          {
            term: {
              status: EChatStatus.queue,
            },
          } as unknown as IElasticsearchBoolClause,
          this.buildNoParticipantFilter(),
          this.buildQueueSectorFilter(userSectors, canViewInSector),
        ],
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildSectorStatusVisibilityFilter(
    statuses: EChatStatus[],
    userSectors: string[]
  ): IElasticsearchBoolClause {
    return {
      bool: {
        must: [
          this.buildStatusFilter(statuses),
          this.buildSectorAccessFilter(userSectors),
        ],
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildReadableChatFilter(
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[]
  ): IElasticsearchBoolClause | null {
    if (this.canListAllChatsWithoutSectorLimit(actions)) {
      return null;
    }

    const canViewInSector = this.canViewChatsInSector(actions);
    const canViewChatbotInputMessages =
      this.canViewChatbotInputMessages(actions);
    const readableClauses: IElasticsearchBoolClause[] = [
      this.buildParticipantFilter(userId),
    ];

    if (canViewChatbotInputMessages) {
      readableClauses.push(this.buildChatbotInputStatusFilter());
    }

    if (canViewInSector) {
      const sectorStatuses = [
        EChatStatus.in_chat,
        EChatStatus.ura_output,
        EChatStatus.ura_schedule,
        EChatStatus.ura_webhook,
        EChatStatus.closed,
      ];

      if (!canViewChatbotInputMessages) {
        sectorStatuses.push(EChatStatus.ura);
      }

      readableClauses.push(
        this.buildSectorStatusVisibilityFilter(sectorStatuses, userSectors)
      );
    }

    if (this.hasChatAccessPermission(actions)) {
      readableClauses.push(
        this.buildQueueWithoutParticipantFilter(userSectors, canViewInSector)
      );
    }

    return {
      bool: {
        should: readableClauses,
        minimum_should_match: 1,
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildSectorFilter(sectorId: string): IElasticsearchBoolClause {
    return {
      nested: {
        path: 'sector',
        query: {
          term: {
            'sector.id': sectorId,
          },
        },
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildWorkerFilter(workerId: string): IElasticsearchBoolClause {
    return {
      nested: {
        path: 'worker',
        query: {
          term: {
            'worker.id': workerId,
          },
        },
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildChannelFilter(channelIds: string[]): IElasticsearchBoolClause {
    return {
      nested: {
        path: 'worker',
        query: {
          terms: {
            'worker.id': channelIds,
          },
        },
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildLabelFilter(labelTemplateId: string): IElasticsearchBoolClause {
    return {
      nested: {
        path: 'label',
        query: {
          term: {
            'label.label_template_id': labelTemplateId,
          },
        },
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildNameFilter(filterName: string): IElasticsearchBoolClause {
    return {
      bool: {
        should: [
          {
            wildcard: {
              'name.keyword': {
                value: `*${filterName.toLowerCase()}*`,
                case_insensitive: true,
              },
            },
          },
          {
            query_string: {
              default_field: 'name',
              query: `*${filterName}*`,
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
                    value: `*${filterName.toLowerCase()}*`,
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
                  query: `*${filterName}*`,
                  analyze_wildcard: true,
                  default_operator: 'OR',
                },
              },
            },
          },
        ],
        minimum_should_match: 1,
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildProtocolFilter(
    filterProtocol: string
  ): IElasticsearchBoolClause {
    return {
      bool: {
        should: [
          {
            wildcard: {
              'protocol_ura.keyword': {
                value: `*${filterProtocol.toLowerCase()}*`,
                case_insensitive: true,
              },
            },
          },
          {
            wildcard: {
              'protocol_start.keyword': {
                value: `*${filterProtocol.toLowerCase()}*`,
                case_insensitive: true,
              },
            },
          },
          {
            wildcard: {
              'protocol_transfer.keyword': {
                value: `*${filterProtocol.toLowerCase()}*`,
                case_insensitive: true,
              },
            },
          },
        ],
        minimum_should_match: 1,
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildDateFilter(
    filterDateStart?: string | null,
    filterDateEnd?: string | null
  ): IElasticsearchBoolClause {
    const dateRange: Record<string, string> = {};
    if (filterDateStart) {
      dateRange.gte = filterDateStart;
    }
    if (filterDateEnd) {
      dateRange.lte = filterDateEnd;
    }

    return {
      range: {
        date: dateRange,
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildSearchTextClauses(
    searchTerm: string
  ): IElasticsearchBoolClause[] {
    const shouldClauses: IElasticsearchBoolClause[] = [
      {
        wildcard: {
          'name.keyword': {
            value: `*${searchTerm.toLowerCase()}*`,
            case_insensitive: true,
          },
        },
      } as unknown as IElasticsearchBoolClause,
      {
        query_string: {
          default_field: 'name',
          query: `*${searchTerm}*`,
          analyze_wildcard: true,
          default_operator: 'OR',
        },
      } as unknown as IElasticsearchBoolClause,
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
      } as unknown as IElasticsearchBoolClause,
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
      } as unknown as IElasticsearchBoolClause,
    ];

    const phoneSearchClause = buildPhoneSearchClause(searchTerm);
    if (phoneSearchClause) {
      shouldClauses.push(phoneSearchClause);
    }

    return shouldClauses;
  }

  private buildFilterClauses(
    query: SearchChatsQuery,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userChannels: { id: string; name: string }[]
  ): {
    filterClauses: IElasticsearchBoolClause[];
    baseFiltersForCounts: IElasticsearchBoolClause[];
    isMyChats: boolean;
  } {
    const filterClauses: IElasticsearchBoolClause[] = [];
    const baseFiltersForCounts: IElasticsearchBoolClause[] = [];

    const channelIds = extractUserChannelIds(userChannels);
    if (channelIds.length > 0) {
      const channelFilter = this.buildChannelFilter(channelIds);
      filterClauses.push(channelFilter);
      baseFiltersForCounts.push(channelFilter);
    }

    if (query.filter_label_template_id) {
      const labelFilter = this.buildLabelFilter(query.filter_label_template_id);
      filterClauses.push(labelFilter);
      baseFiltersForCounts.push(labelFilter);
    }

    if (query.filter_worker_id) {
      const workerFilter = this.buildWorkerFilter(query.filter_worker_id);
      filterClauses.push(workerFilter);
      baseFiltersForCounts.push(workerFilter);
    }

    if (query.filter_user_id) {
      const canFilterByAnyUser =
        this.canViewOthersChats(actions) ||
        this.canListAllChatsWithoutSectorLimit(actions) ||
        this.canViewChatsInSector(actions);

      const effectiveFilterUserId =
        canFilterByAnyUser || query.filter_user_id === userId
          ? query.filter_user_id
          : userId;

      const userFilter = this.buildParticipantFilter(effectiveFilterUserId);
      filterClauses.push(userFilter);
      baseFiltersForCounts.push(userFilter);
    }

    if (
      query.filter_sector_id &&
      this.canListAllChatsWithoutSectorLimit(actions)
    ) {
      const sectorFilter = this.buildSectorFilter(query.filter_sector_id);
      filterClauses.push(sectorFilter);
      baseFiltersForCounts.push(sectorFilter);
    }

    if (query.filter_name) {
      const nameFilter = this.buildNameFilter(query.filter_name);
      filterClauses.push(nameFilter);
      baseFiltersForCounts.push(nameFilter);
    }

    if (query.filter_phone) {
      const phoneFilterClause = buildPhoneSearchClause(query.filter_phone);
      if (phoneFilterClause) {
        filterClauses.push(phoneFilterClause);
        baseFiltersForCounts.push(phoneFilterClause);
      }
    }

    if (query.filter_protocol) {
      const protocolFilter = this.buildProtocolFilter(query.filter_protocol);
      filterClauses.push(protocolFilter);
      baseFiltersForCounts.push(protocolFilter);
    }

    if (query.filter_date_start || query.filter_date_end) {
      const dateFilter = this.buildDateFilter(
        query.filter_date_start,
        query.filter_date_end
      );
      filterClauses.push(dateFilter);
      baseFiltersForCounts.push(dateFilter);
    }

    const isMyChats = query.status === MY_CHATS_STATUS;
    const statusArray =
      query.status !== null && query.status !== undefined
        ? isMyChats
          ? [EChatStatus.queue, EChatStatus.in_chat]
          : Array.isArray(query.status)
            ? query.status
            : [query.status]
        : [];

    if (query.status !== null && query.status !== undefined && !isMyChats) {
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

    return {
      filterClauses,
      baseFiltersForCounts,
      isMyChats,
    };
  }

  private async getUserSortPreferences(userId: string): Promise<{
    sortByChatOrder: string;
    sortInChatOrder: string;
    sortByMyChatsOrder: string;
    sortMyChatsOrder: string;
    sortByQueueOrder: string;
    sortQueueOrder: string;
    sortByChatbotOrder: string;
    sortChatbotOrder: string;
  }> {
    const chatUser = await this.chatUserService.viewChatUser(userId);

    return {
      sortByChatOrder: chatUser?.sort_by_chat_order ?? 'summary.last_message',
      sortInChatOrder: chatUser?.sort_in_chat_order ?? 'desc',
      sortByMyChatsOrder:
        chatUser?.sort_by_my_chats_order ?? 'summary.last_message',
      sortMyChatsOrder: chatUser?.sort_my_chats_order ?? 'desc',
      sortByQueueOrder: chatUser?.sort_by_queue_order ?? 'summary.last_message',
      sortQueueOrder: chatUser?.sort_queue_order ?? 'desc',
      sortByChatbotOrder:
        chatUser?.sort_by_chatbot_order ?? 'summary.last_message',
      sortChatbotOrder: chatUser?.sort_chatbot_order ?? 'desc',
    };
  }

  async execute(
    accountId: string,
    query: SearchChatsQuery,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = []
  ): Promise<SearchChatsResponse> {
    const currentPage = query.current_page ?? 1;
    const perPage = query.per_page ?? 10;
    const searchTerm = query.search?.trim() || '';

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

    const filterResult = this.buildFilterClauses(
      query,
      userId,
      actions,
      userChannels
    );
    const { filterClauses, baseFiltersForCounts, isMyChats } = filterResult;
    const readableChatFilter = this.buildReadableChatFilter(
      userId,
      actions,
      userSectors
    );

    if (readableChatFilter) {
      filterClauses.push(readableChatFilter);
      baseFiltersForCounts.push(readableChatFilter);
    }

    if (isMyChats) {
      filterClauses.push(this.buildMyChatsFilter(userId));
    }

    const shouldClauses = this.buildSearchTextClauses(searchTerm);

    let sortField = query.sort_field;
    let sortOrder = query.sort_order;

    if (!sortField || !sortOrder) {
      const userPreferences = await this.getUserSortPreferences(userId);

      if (isMyChats) {
        sortField = sortField || userPreferences.sortByMyChatsOrder;
        sortOrder = sortOrder || userPreferences.sortMyChatsOrder;
      } else {
        sortField = sortField || userPreferences.sortByChatOrder;
        sortOrder = sortOrder || userPreferences.sortInChatOrder;
      }

      if (!sortField) {
        sortField = 'summary.last_message';
      }
      if (!sortOrder) {
        sortOrder = 'desc';
      }
    }
    const sanitizedSort = this.sanitizeSort(sortField, sortOrder);
    const normalizedSortBy = sanitizedSort.sortBy;
    const normalizedSortOrder = sanitizedSort.sortOrder;

    const getSortField = (field: string) => {
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
      return fieldMap[field] || 'summary.last_date';
    };

    const getSortConfig = (fieldValue: string, orderValue: 'asc' | 'desc') => {
      const field = getSortField(fieldValue);

      if (field === 'account.name.keyword') {
        return [
          {
            'account.name.keyword': {
              order: orderValue,
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
              order: orderValue,
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
              order: orderValue,
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
              order: orderValue,
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
              order: orderValue,
              nested: {
                path: 'summary',
              },
            },
          },
        ];
      }

      return [{ [field]: { order: orderValue } }];
    };

    const queryElastic: any = {
      from: (currentPage - 1) * perPage,
      size: perPage,
      sort: getSortConfig(normalizedSortBy, normalizedSortOrder),
      query: {
        bool: {
          must: mustClauses,
          ...(shouldClauses.length > 0
            ? {
                should: shouldClauses,
                minimum_should_match: 1,
              }
            : {}),
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
      return [
        ...baseFiltersForCounts,
        {
          term: {
            status: EChatStatus.queue,
          },
        } as unknown as IElasticsearchBoolClause,
      ];
    };

    const buildInChatLikeCountFilter = (
      statuses: EChatStatus[]
    ): IElasticsearchBoolClause[] => {
      return [...baseFiltersForCounts, this.buildStatusFilter(statuses)];
    };

    const buildInChatCountFilter = (): IElasticsearchBoolClause[] =>
      buildInChatLikeCountFilter([EChatStatus.in_chat]);

    const buildInChatMineCountFilter = (): IElasticsearchBoolClause[] => [
      ...buildInChatLikeCountFilter([EChatStatus.in_chat]),
      this.buildParticipantFilter(userId),
    ];

    const buildChatbotCountFilter = (): IElasticsearchBoolClause[] => {
      const chatbotStatuses: EChatStatus[] = [
        EChatStatus.ura,
        EChatStatus.ura_output,
        EChatStatus.ura_webhook,
      ];

      return buildInChatLikeCountFilter(chatbotStatuses);
    };

    const buildChatbotInputCountFilter = (): IElasticsearchBoolClause[] => {
      return buildInChatLikeCountFilter([EChatStatus.ura]);
    };

    const buildChatbotOutputCountFilter = (): IElasticsearchBoolClause[] =>
      buildInChatLikeCountFilter([EChatStatus.ura_output]);

    const buildScheduleCountFilter = (): IElasticsearchBoolClause[] =>
      buildInChatLikeCountFilter([EChatStatus.ura_schedule]);

    const buildChatbotWebhookCountFilter = (): IElasticsearchBoolClause[] =>
      buildInChatLikeCountFilter([EChatStatus.ura_webhook]);

    const buildClosedCountFilter = (): IElasticsearchBoolClause[] => {
      return [
        ...baseFiltersForCounts,
        {
          term: {
            status: EChatStatus.closed,
          },
        } as unknown as IElasticsearchBoolClause,
      ];
    };

    const buildMyChatsCountFilter = (): IElasticsearchBoolClause[] => {
      return [...baseFiltersForCounts, this.buildMyChatsFilter(userId)];
    };

    const queueCountQuery: any = {
      size: 0,
      query: {
        bool: {
          must: mustClauses,
          ...(shouldClauses.length > 0
            ? {
                should: shouldClauses,
                minimum_should_match: 1,
              }
            : {}),
          filter: buildQueueCountFilter(),
        },
      },
    };

    const inChatCountQuery: any = {
      size: 0,
      query: {
        bool: {
          must: mustClauses,
          ...(shouldClauses.length > 0
            ? {
                should: shouldClauses,
                minimum_should_match: 1,
              }
            : {}),
          filter: buildInChatCountFilter(),
        },
      },
    };

    const chatbotCountQuery: any = {
      size: 0,
      query: {
        bool: {
          must: mustClauses,
          ...(shouldClauses.length > 0
            ? {
                should: shouldClauses,
                minimum_should_match: 1,
              }
            : {}),
          filter: buildChatbotCountFilter(),
        },
      },
    };

    const closedCountQuery: any = {
      size: 0,
      query: {
        bool: {
          must: mustClauses,
          ...(shouldClauses.length > 0
            ? {
                should: shouldClauses,
                minimum_should_match: 1,
              }
            : {}),
          filter: buildClosedCountFilter(),
        },
      },
    };

    const scheduleCountQuery: any = {
      size: 0,
      query: {
        bool: {
          must: mustClauses,
          ...(shouldClauses.length > 0
            ? {
                should: shouldClauses,
                minimum_should_match: 1,
              }
            : {}),
          filter: buildScheduleCountFilter(),
        },
      },
    };

    const inChatMineCountQuery: any = {
      size: 0,
      query: {
        bool: {
          must: mustClauses,
          ...(shouldClauses.length > 0
            ? {
                should: shouldClauses,
                minimum_should_match: 1,
              }
            : {}),
          filter: buildInChatMineCountFilter(),
        },
      },
    };

    const chatbotInputCountQuery: any = {
      size: 0,
      query: {
        bool: {
          must: mustClauses,
          ...(shouldClauses.length > 0
            ? {
                should: shouldClauses,
                minimum_should_match: 1,
              }
            : {}),
          filter: buildChatbotInputCountFilter(),
        },
      },
    };

    const chatbotOutputCountQuery: any = {
      size: 0,
      query: {
        bool: {
          must: mustClauses,
          ...(shouldClauses.length > 0
            ? {
                should: shouldClauses,
                minimum_should_match: 1,
              }
            : {}),
          filter: buildChatbotOutputCountFilter(),
        },
      },
    };

    const chatbotWebhookCountQuery: any = {
      size: 0,
      query: {
        bool: {
          must: mustClauses,
          ...(shouldClauses.length > 0
            ? {
                should: shouldClauses,
                minimum_should_match: 1,
              }
            : {}),
          filter: buildChatbotWebhookCountFilter(),
        },
      },
    };

    const myChatsCountQuery: any = {
      size: 0,
      query: {
        bool: {
          must: mustClauses,
          ...(shouldClauses.length > 0
            ? {
                should: shouldClauses,
                minimum_should_match: 1,
              }
            : {}),
          filter: buildMyChatsCountFilter(),
        },
      },
    };

    const [
      initialResult,
      queueCountResult,
      inChatCountResult,
      chatbotCountResult,
      scheduleCountResult,
      closedCountResult,
      inChatMineCountResult,
      chatbotInputCountResult,
      chatbotOutputCountResult,
      chatbotWebhookCountResult,
      myChatsCountResult,
    ] = await Promise.all([
      this.elasticDatabaseService.select(EElasticIndex.chat, queryElastic),
      this.elasticDatabaseService.select(EElasticIndex.chat, queueCountQuery),
      this.elasticDatabaseService.select(EElasticIndex.chat, inChatCountQuery),
      this.elasticDatabaseService.select(EElasticIndex.chat, chatbotCountQuery),
      this.elasticDatabaseService.select(
        EElasticIndex.chat,
        scheduleCountQuery
      ),
      this.elasticDatabaseService.select(EElasticIndex.chat, closedCountQuery),
      this.elasticDatabaseService.select(
        EElasticIndex.chat,
        inChatMineCountQuery
      ),
      this.elasticDatabaseService.select(
        EElasticIndex.chat,
        chatbotInputCountQuery
      ),
      this.elasticDatabaseService.select(
        EElasticIndex.chat,
        chatbotOutputCountQuery
      ),
      this.elasticDatabaseService.select(
        EElasticIndex.chat,
        chatbotWebhookCountQuery
      ),
      this.elasticDatabaseService.select(EElasticIndex.chat, myChatsCountQuery),
    ]);

    let result = initialResult;
    if (!result) {
      const fallbackQueryElastic = {
        ...queryElastic,
        sort: getSortConfig('summary.last_message', 'desc'),
      };
      result = await this.elasticDatabaseService.select(
        EElasticIndex.chat,
        fallbackQueryElastic
      );
    }

    const queueTotal =
      (queueCountResult?.hits?.total as { value: number })?.value || 0;
    const inChatTotal =
      (inChatCountResult?.hits?.total as { value: number })?.value || 0;
    const chatbotTotal =
      (chatbotCountResult?.hits?.total as { value: number })?.value || 0;
    const scheduleTotal =
      (scheduleCountResult?.hits?.total as { value: number })?.value || 0;
    const closedTotal =
      (closedCountResult?.hits?.total as { value: number })?.value || 0;
    const inChatMineTotal =
      (inChatMineCountResult?.hits?.total as { value: number })?.value || 0;
    const chatbotInputTotal =
      (chatbotInputCountResult?.hits?.total as { value: number })?.value || 0;
    const chatbotOutputTotal =
      (chatbotOutputCountResult?.hits?.total as { value: number })?.value || 0;
    const chatbotWebhookTotal =
      (chatbotWebhookCountResult?.hits?.total as { value: number })?.value || 0;
    const myChatsTotal =
      (myChatsCountResult?.hits?.total as { value: number })?.value || 0;
    const totalCount = queueTotal + inChatTotal;

    if (!result) {
      const pagings = setPaginationData(0, 0, perPage, currentPage);

      return {
        pagings,
        results: [],
        counts: {
          total: totalCount,
          queue: queueTotal,
          in_chat: inChatTotal,
          chatbot: chatbotTotal,
          schedule: scheduleTotal,
          closed: closedTotal,
          my_chats: myChatsTotal,
          in_chat_mine: inChatMineTotal,
          chatbot_input: chatbotInputTotal,
          chatbot_output: chatbotOutputTotal,
          chatbot_schedule: scheduleTotal,
          chatbot_webhook: chatbotWebhookTotal,
        },
      };
    }

    const chats = result.hits.hits.map((hit) => {
      const source = hit._source as ListChatsResult;
      if (!source.chat_id && hit._id) {
        source.chat_id = hit._id;
      }
      if (Array.isArray(source.summary)) {
        source.summary = source.summary[0] ?? null;
      }
      if (!Array.isArray(source.secondary_users)) {
        source.secondary_users = [];
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
      counts: {
        total: totalCount,
        queue: queueTotal,
        in_chat: inChatTotal,
        chatbot: chatbotTotal,
        schedule: scheduleTotal,
        closed: closedTotal,
        my_chats: myChatsTotal,
        in_chat_mine: inChatMineTotal,
        chatbot_input: chatbotInputTotal,
        chatbot_output: chatbotOutputTotal,
        chatbot_schedule: scheduleTotal,
        chatbot_webhook: chatbotWebhookTotal,
      },
    };
  }
}
