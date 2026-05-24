import { injectable, inject } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import {
  ListChatsQuery,
  MY_CHATS_STATUS,
} from '@core/schema/chat/listChats/request.schema';
import {
  ListChatsResponse,
  ListChatsResult,
} from '@core/schema/chat/listChats/response.schema';
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
export class ChatListerUseCase {
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

  private buildClosedVisibilityIncludingNoSector(
    userId: string,
    userSectors: string[]
  ): IElasticsearchBoolClause {
    const closedShould: unknown[] = [
      this.buildParticipantFilter(userId),
      {
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
      },
    ];
    if (userSectors.length > 0) {
      closedShould.push({
        nested: {
          path: 'sector',
          query: {
            terms: {
              'sector.id': userSectors,
            },
          },
        },
      });
    }
    return {
      bool: {
        should: closedShould,
        minimum_should_match: 1,
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildInChatVisibilityIncludingNoSector(
    userId: string,
    userSectors: string[]
  ): IElasticsearchBoolClause {
    const inChatShould: unknown[] = [
      this.buildParticipantFilter(userId),
      {
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
      } as unknown as IElasticsearchBoolClause,
    ];
    if (userSectors.length > 0) {
      inChatShould.push({
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
    return {
      bool: {
        should: inChatShould,
        minimum_should_match: 1,
      },
    } as unknown as IElasticsearchBoolClause;
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

  private getSortForStatus(
    status: string | string[],
    filterStatus: string | null | undefined,
    preferences: {
      sortByChatOrder: string;
      sortInChatOrder: string;
      sortByMyChatsOrder: string;
      sortMyChatsOrder: string;
      sortByQueueOrder: string;
      sortQueueOrder: string;
      sortByChatbotOrder: string;
      sortChatbotOrder: string;
    }
  ): { sortBy: string; sortOrder: string } {
    const statusArray = Array.isArray(status) ? status : [status];

    const isMyChatsStatus =
      status === MY_CHATS_STATUS ||
      (statusArray.length === 2 &&
        statusArray.includes(EChatStatus.in_chat) &&
        statusArray.includes(EChatStatus.queue) &&
        (filterStatus === null || filterStatus === undefined));

    if (isMyChatsStatus) {
      return {
        sortBy: preferences.sortByMyChatsOrder,
        sortOrder: preferences.sortMyChatsOrder,
      };
    }

    if (filterStatus !== undefined && filterStatus !== null) {
      if (filterStatus === EChatStatus.queue) {
        return {
          sortBy: preferences.sortByQueueOrder,
          sortOrder: preferences.sortQueueOrder,
        };
      }

      if (
        filterStatus === EChatStatus.ura ||
        filterStatus === EChatStatus.ura_output ||
        filterStatus === EChatStatus.ura_schedule ||
        filterStatus === EChatStatus.ura_webhook
      ) {
        return {
          sortBy: preferences.sortByChatbotOrder,
          sortOrder: preferences.sortChatbotOrder,
        };
      }

      return {
        sortBy: preferences.sortByChatOrder,
        sortOrder: preferences.sortInChatOrder,
      };
    }

    if (statusArray.length > 1) {
      const isChatbotMultiStatus =
        statusArray.length > 0 &&
        statusArray.every((currentStatus) =>
          this.isChatbotSortStatus(currentStatus)
        );

      if (isChatbotMultiStatus) {
        return {
          sortBy: preferences.sortByChatbotOrder,
          sortOrder: preferences.sortChatbotOrder,
        };
      }

      return {
        sortBy: preferences.sortByChatOrder,
        sortOrder: preferences.sortInChatOrder,
      };
    }

    const singleStatus = statusArray[0];

    if (singleStatus === EChatStatus.in_chat) {
      return {
        sortBy: preferences.sortByChatOrder,
        sortOrder: preferences.sortInChatOrder,
      };
    }

    if (singleStatus === EChatStatus.queue) {
      return {
        sortBy: preferences.sortByQueueOrder,
        sortOrder: preferences.sortQueueOrder,
      };
    }

    if (
      singleStatus === EChatStatus.ura ||
      singleStatus === EChatStatus.ura_output ||
      singleStatus === EChatStatus.ura_schedule ||
      singleStatus === EChatStatus.ura_webhook
    ) {
      return {
        sortBy: preferences.sortByChatbotOrder,
        sortOrder: preferences.sortChatbotOrder,
      };
    }

    return {
      sortBy: 'summary.last_message',
      sortOrder: 'desc',
    };
  }

  private isChatbotSortStatus(status: string): boolean {
    return (
      status === EChatStatus.ura ||
      status === EChatStatus.ura_output ||
      status === EChatStatus.ura_schedule ||
      status === EChatStatus.ura_webhook
    );
  }

  private sanitizeSort(
    sortBy: string,
    sortOrder: string
  ): { sortBy: string; sortOrder: 'asc' | 'desc' } {
    const normalizedSortBy = this.allowedSortByFields.has(sortBy)
      ? sortBy
      : 'summary.last_message';

    const normalizedSortOrder =
      sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : 'desc';

    return {
      sortBy: normalizedSortBy,
      sortOrder: normalizedSortOrder,
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

  private getHitsTotal(
    total:
      | {
          value?: number;
        }
      | number
      | null
      | undefined
  ): number {
    if (typeof total === 'number' && Number.isFinite(total)) {
      return total;
    }

    if (
      total &&
      typeof total === 'object' &&
      typeof total.value === 'number' &&
      Number.isFinite(total.value)
    ) {
      return total.value;
    }

    return 0;
  }

  private mapResultHitsToChats(
    hits: Array<{ _id?: string; _source?: unknown }>
  ): ListChatsResult[] {
    return hits.reduce<ListChatsResult[]>((acc, hit) => {
      if (!hit._source) {
        return acc;
      }

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

      acc.push(source);
      return acc;
    }, []);
  }

  private buildCountsFromCountResults(
    countResults: any[]
  ): ListChatsResponse['counts'] {
    const [
      queueCountResult,
      inChatCountResult,
      chatbotCountResult,
      scheduleCountResult,
      inChatMineCountResult,
      chatbotInputCountResult,
      chatbotOutputCountResult,
      chatbotWebhookCountResult,
      myChatsCountResult,
    ] = countResults;

    const queueTotal = this.getHitsTotal(queueCountResult?.hits?.total);
    const inChatTotal = this.getHitsTotal(inChatCountResult?.hits?.total);
    const chatbotTotal = this.getHitsTotal(chatbotCountResult?.hits?.total);
    const scheduleTotal = this.getHitsTotal(scheduleCountResult?.hits?.total);
    const inChatMineTotal = this.getHitsTotal(
      inChatMineCountResult?.hits?.total
    );
    const chatbotInputTotal = this.getHitsTotal(
      chatbotInputCountResult?.hits?.total
    );
    const chatbotOutputTotal = this.getHitsTotal(
      chatbotOutputCountResult?.hits?.total
    );
    const chatbotWebhookTotal = this.getHitsTotal(
      chatbotWebhookCountResult?.hits?.total
    );
    const myChatsTotal = this.getHitsTotal(myChatsCountResult?.hits?.total);
    const totalCount = queueTotal + inChatTotal;

    return {
      total: totalCount,
      queue: queueTotal,
      in_chat: inChatTotal,
      chatbot: chatbotTotal,
      schedule: scheduleTotal,
      my_chats: myChatsTotal,
      in_chat_mine: inChatMineTotal,
      chatbot_input: chatbotInputTotal,
      chatbot_output: chatbotOutputTotal,
      chatbot_schedule: scheduleTotal,
      chatbot_webhook: chatbotWebhookTotal,
    };
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

  async execute(
    accountId: string,
    query: ListChatsQuery,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = []
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
    const baseFiltersForCounts: IElasticsearchBoolClause[] = [];

    const channelIds = extractUserChannelIds(userChannels);
    if (channelIds.length > 0) {
      const channelFilter: IElasticsearchBoolClause = {
        nested: {
          path: 'worker',
          query: {
            terms: {
              'worker.id': channelIds,
            },
          },
        },
      } as unknown as IElasticsearchBoolClause;
      filterClauses.push(channelFilter);
      baseFiltersForCounts.push(channelFilter);
    }

    const isMyChats = query.status === MY_CHATS_STATUS;
    const statusArray = isMyChats
      ? [EChatStatus.queue, EChatStatus.in_chat]
      : Array.isArray(query.status)
        ? query.status
        : [query.status];

    if (!isMyChats) {
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
      const labelFilter = {
        nested: {
          path: 'label',
          query: {
            term: {
              'label.label_template_id': query.filter_label_template_id,
            },
          },
        },
      };
      filterClauses.push(labelFilter);
      baseFiltersForCounts.push(labelFilter);
    }

    if (query.filter_worker_id) {
      const workerFilter = {
        nested: {
          path: 'worker',
          query: {
            term: {
              'worker.id': query.filter_worker_id,
            },
          },
        },
      };
      filterClauses.push(workerFilter);
      baseFiltersForCounts.push(workerFilter);
    }

    if (
      query.filter_sector_id &&
      this.canListAllChatsWithoutSectorLimit(actions)
    ) {
      const sectorFilter = {
        nested: {
          path: 'sector',
          query: {
            term: {
              'sector.id': query.filter_sector_id,
            },
          },
        },
      };
      filterClauses.push(sectorFilter);
      baseFiltersForCounts.push(sectorFilter);
    }

    if (query.filter_name) {
      const nameFilter = {
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
      } as unknown as IElasticsearchBoolClause;
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
      const protocolFilter = {
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
      } as unknown as IElasticsearchBoolClause;
      filterClauses.push(protocolFilter);
      baseFiltersForCounts.push(protocolFilter);
    }

    if (query.filter_date_start || query.filter_date_end) {
      const dateRange: Record<string, string> = {};
      if (query.filter_date_start) {
        dateRange.gte = query.filter_date_start;
      }
      if (query.filter_date_end) {
        dateRange.lte = query.filter_date_end;
      }
      const dateFilter = {
        range: {
          date: dateRange,
        },
      } as unknown as IElasticsearchBoolClause;
      filterClauses.push(dateFilter);
      baseFiltersForCounts.push(dateFilter);
    }

    const canViewOthers = this.canViewOthersChats(actions);
    const canListAll = this.canListAllChatsWithoutSectorLimit(actions);
    const canViewInSector = this.canViewChatsInSector(actions);
    const canViewChatbotInputMessages =
      this.canViewChatbotInputMessages(actions);

    const requestedFilterUserId = query.filter_user_id ?? null;
    const canFilterByAnyUser = canViewOthers || canListAll || canViewInSector;
    const effectiveFilterUserId = requestedFilterUserId
      ? canFilterByAnyUser || requestedFilterUserId === userId
        ? requestedFilterUserId
        : userId
      : null;

    if (!isMyChats && effectiveFilterUserId) {
      const userFilter = this.buildParticipantFilter(effectiveFilterUserId);

      filterClauses.push(userFilter);
      baseFiltersForCounts.push(userFilter);
    }

    if (isMyChats) {
      const myChatsFilter: IElasticsearchBoolClause = {
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

      filterClauses.push(myChatsFilter);
    }

    if (!isMyChats && !canViewOthers && !canListAll) {
      const unrestrictedChatbotInputStatuses = statusArray.filter(
        (status): status is EChatStatus =>
          status === EChatStatus.ura && canViewChatbotInputMessages
      );

      const restrictedInChatLikeStatuses = statusArray.filter(
        (status): status is EChatStatus =>
          status === EChatStatus.in_chat ||
          status === EChatStatus.ura_output ||
          status === EChatStatus.ura_webhook ||
          status === EChatStatus.ura_schedule ||
          (status === EChatStatus.ura && !canViewChatbotInputMessages)
      );

      if (restrictedInChatLikeStatuses.length > 0) {
        const inChatLikeVisibilityClause: IElasticsearchBoolClause =
          canViewInSector
            ? this.buildInChatVisibilityIncludingNoSector(userId, userSectors)
            : this.buildParticipantFilter(userId);

        if (unrestrictedChatbotInputStatuses.length === 0) {
          filterClauses.push(inChatLikeVisibilityClause);
        } else {
          filterClauses.push({
            bool: {
              should: [
                this.buildStatusFilter(unrestrictedChatbotInputStatuses),
                {
                  bool: {
                    must: [
                      this.buildStatusFilter(restrictedInChatLikeStatuses),
                      inChatLikeVisibilityClause,
                    ],
                  },
                } as unknown as IElasticsearchBoolClause,
              ],
              minimum_should_match: 1,
            },
          } as unknown as IElasticsearchBoolClause);
        }
      }
    }

    if (!isMyChats && !canListAll) {
      if (statusArray.includes(EChatStatus.queue)) {
        const queueSectorClause =
          userSectors.length > 0
            ? canViewInSector
              ? ({
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
                      {
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
                      },
                    ],
                    minimum_should_match: 1,
                  },
                } as unknown as IElasticsearchBoolClause)
              : ({
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
              } as unknown as IElasticsearchBoolClause);
        const queueVisibility: IElasticsearchBoolClause = {
          bool: {
            should: [
              this.buildParticipantFilter(userId),
              {
                bool: {
                  must: [this.buildNoParticipantFilter(), queueSectorClause],
                },
              } as unknown as IElasticsearchBoolClause,
            ],
            minimum_should_match: 1,
          },
        } as unknown as IElasticsearchBoolClause;

        filterClauses.push(queueVisibility);
      }

      if (!isMyChats && statusArray.includes(EChatStatus.closed)) {
        if (!canViewOthers && !canListAll) {
          if (canViewInSector) {
            filterClauses.push(
              this.buildClosedVisibilityIncludingNoSector(userId, userSectors)
            );
          } else {
            filterClauses.push(this.buildParticipantFilter(userId));
          }
        } else if (!canListAll) {
          const closedVisibility: IElasticsearchBoolClause = {
            bool: {
              should: [
                this.buildParticipantFilter(userId),
                {
                  bool: {
                    must: [
                      this.buildNoParticipantFilter(),
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

          filterClauses.push(closedVisibility);
        }
      }
    }

    const userPreferences = await this.getUserSortPreferences(userId);
    const { sortBy: rawSortBy, sortOrder: rawSortOrder } =
      this.getSortForStatus(query.status, null, userPreferences);
    const { sortBy, sortOrder } = this.sanitizeSort(rawSortBy, rawSortOrder);
    const sort = this.buildElasticsearchSort(sortBy, sortOrder);
    const fallbackSort = this.buildElasticsearchSort(
      'summary.last_message',
      'desc'
    );

    const queryElastic = {
      from: (currentPage - 1) * perPage,
      size: perPage,
      track_total_hits: true,
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
      if (canListAll) {
        return [
          ...baseFiltersForCounts,
          {
            term: {
              status: EChatStatus.queue,
            },
          } as unknown as IElasticsearchBoolClause,
        ];
      }

      const queueSectorClause =
        userSectors.length > 0
          ? canViewInSector
            ? ({
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
                    {
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
                    },
                  ],
                  minimum_should_match: 1,
                },
              } as unknown as IElasticsearchBoolClause)
            : ({
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
            } as unknown as IElasticsearchBoolClause);
      const queueVisibility: IElasticsearchBoolClause = {
        bool: {
          should: [
            this.buildParticipantFilter(userId),
            {
              bool: {
                must: [this.buildNoParticipantFilter(), queueSectorClause],
              },
            } as unknown as IElasticsearchBoolClause,
          ],
          minimum_should_match: 1,
        },
      } as unknown as IElasticsearchBoolClause;

      return [
        ...baseFiltersForCounts,
        {
          term: {
            status: EChatStatus.queue,
          },
        } as unknown as IElasticsearchBoolClause,
        queueVisibility,
      ];
    };

    const buildInChatLikeCountFilter = (
      statuses: EChatStatus[]
    ): IElasticsearchBoolClause[] => {
      const statusFilter = this.buildStatusFilter(statuses);

      if (canViewOthers || canListAll) {
        return [...baseFiltersForCounts, statusFilter];
      }

      if (canViewInSector) {
        return [
          ...baseFiltersForCounts,
          statusFilter,
          this.buildInChatVisibilityIncludingNoSector(userId, userSectors),
        ];
      }

      return [
        ...baseFiltersForCounts,
        statusFilter,
        this.buildParticipantFilter(userId),
      ];
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

      if (canViewOthers || canListAll) {
        return [
          ...baseFiltersForCounts,
          this.buildStatusFilter(chatbotStatuses),
        ];
      }

      if (!canViewChatbotInputMessages) {
        return buildInChatLikeCountFilter(chatbotStatuses);
      }

      const inChatLikeVisibilityClause: IElasticsearchBoolClause =
        canViewInSector
          ? this.buildInChatVisibilityIncludingNoSector(userId, userSectors)
          : this.buildParticipantFilter(userId);

      return [
        ...baseFiltersForCounts,
        this.buildStatusFilter(chatbotStatuses),
        {
          bool: {
            should: [
              {
                term: {
                  status: EChatStatus.ura,
                },
              } as unknown as IElasticsearchBoolClause,
              {
                bool: {
                  must: [
                    this.buildStatusFilter([
                      EChatStatus.ura_output,
                      EChatStatus.ura_webhook,
                    ]),
                    inChatLikeVisibilityClause,
                  ],
                },
              } as unknown as IElasticsearchBoolClause,
            ],
            minimum_should_match: 1,
          },
        } as unknown as IElasticsearchBoolClause,
      ];
    };

    const buildChatbotInputCountFilter = (): IElasticsearchBoolClause[] => {
      if (canViewOthers || canListAll || canViewChatbotInputMessages) {
        return [
          ...baseFiltersForCounts,
          {
            term: {
              status: EChatStatus.ura,
            },
          } as unknown as IElasticsearchBoolClause,
        ];
      }

      return buildInChatLikeCountFilter([EChatStatus.ura]);
    };

    const buildChatbotOutputCountFilter = (): IElasticsearchBoolClause[] =>
      buildInChatLikeCountFilter([EChatStatus.ura_output]);

    const buildScheduleCountFilter = (): IElasticsearchBoolClause[] =>
      buildInChatLikeCountFilter([EChatStatus.ura_schedule]);

    const buildChatbotWebhookCountFilter = (): IElasticsearchBoolClause[] =>
      buildInChatLikeCountFilter([EChatStatus.ura_webhook]);

    const buildMyChatsCountFilter = (): IElasticsearchBoolClause[] => {
      const myChatsFilter: IElasticsearchBoolClause = {
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

      return [...baseFiltersForCounts, myChatsFilter];
    };

    const buildCountQuery = (countFilter: IElasticsearchBoolClause[]) => ({
      size: 0,
      track_total_hits: true,
      query: {
        bool: {
          must: mustClauses,
          filter: countFilter,
        },
      },
    });

    const countFilters: IElasticsearchBoolClause[][] = [
      buildQueueCountFilter(),
      buildInChatCountFilter(),
      buildChatbotCountFilter(),
      buildScheduleCountFilter(),
      buildInChatMineCountFilter(),
      buildChatbotInputCountFilter(),
      buildChatbotOutputCountFilter(),
      buildChatbotWebhookCountFilter(),
      buildMyChatsCountFilter(),
    ];

    const [initialResult, ...countResults] = await Promise.all([
      this.elasticDatabaseService.select(EElasticIndex.chat, queryElastic),
      ...countFilters.map((countFilter) =>
        this.elasticDatabaseService.select(
          EElasticIndex.chat,
          buildCountQuery(countFilter)
        )
      ),
    ]);

    let result = initialResult;
    if (!result) {
      const fallbackQueryElastic = {
        ...queryElastic,
        sort: fallbackSort,
      };
      result = await this.elasticDatabaseService.select(
        EElasticIndex.chat,
        fallbackQueryElastic
      );
    }

    const counts = this.buildCountsFromCountResults(countResults);

    if (!result) {
      const pagings = setPaginationData(0, 0, perPage, currentPage);

      return {
        pagings,
        results: [],
        counts,
      };
    }

    const chats = this.mapResultHitsToChats(result.hits.hits);
    const total = this.getHitsTotal(result.hits.total);

    const pagings = setPaginationData(
      chats.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results: chats,
      counts,
    };
  }
}
