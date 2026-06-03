import { injectable, inject } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import type { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import type { IElasticsearchBoolClause } from '@core/common/interfaces/IElasticsearchQuery';
import { extractUserChannelIds } from '@core/common/functions/extractUserChannelIds';
import type { ChatUnreadSummaryData } from '@core/schema/chat/unreadSummary/response.schema';

type UnreadSummaryAggregations = {
  summary?: {
    unread_total?: {
      value?: number | null;
    };
  };
};

@injectable()
export class ChatUnreadSummaryViewerUseCase {
  private readonly visibleMenuStatuses: EChatStatus[] = [
    EChatStatus.queue,
    EChatStatus.in_chat,
    EChatStatus.ura,
    EChatStatus.ura_output,
    EChatStatus.ura_schedule,
    EChatStatus.ura_webhook,
  ];

  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  private canViewOthersChats(actions: IJwtGroupHierarchy[]): boolean {
    return hasRequiredPermission(actions, [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
    ]);
  }

  private canViewChatsInSector(actions: IJwtGroupHierarchy[]): boolean {
    return hasRequiredPermission(actions, [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.list_all_chats_in_sector,
    ]);
  }

  private canListAllChatsWithoutSectorLimit(
    actions: IJwtGroupHierarchy[]
  ): boolean {
    return hasRequiredPermission(actions, [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.list_all_chats_without_sector_limit,
    ]);
  }

  private canViewChatbotInputMessages(actions: IJwtGroupHierarchy[]): boolean {
    return hasRequiredPermission(actions, [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.view_chatbot_messages,
      EChatbotPermissions.chatbot_group,
      EChatbotPermissions.chatbot_access,
    ]);
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

  private buildInChatVisibilityIncludingNoSector(
    userId: string,
    userSectors: string[]
  ): IElasticsearchBoolClause {
    const inChatShould: unknown[] = [
      this.buildParticipantFilter(userId),
      this.buildNoSectorFilter(),
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

  private buildQueueSectorClause(
    userSectors: string[],
    canViewInSector: boolean
  ): IElasticsearchBoolClause {
    if (userSectors.length > 0) {
      if (canViewInSector) {
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

    return this.buildNoSectorFilter();
  }

  private buildQueueVisibilityClause(
    userId: string,
    userSectors: string[],
    canViewInSector: boolean
  ): IElasticsearchBoolClause {
    return {
      bool: {
        should: [
          this.buildParticipantFilter(userId),
          {
            bool: {
              must: [
                this.buildNoParticipantFilter(),
                this.buildQueueSectorClause(userSectors, canViewInSector),
              ],
            },
          } as unknown as IElasticsearchBoolClause,
        ],
        minimum_should_match: 1,
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

  private buildVisibleChatsFilter(input: {
    userId: string;
    actions: IJwtGroupHierarchy[];
    userSectors: string[];
  }): IElasticsearchBoolClause {
    const canViewOthers = this.canViewOthersChats(input.actions);
    const canListAll = this.canListAllChatsWithoutSectorLimit(input.actions);
    const canViewInSector = this.canViewChatsInSector(input.actions);
    const canViewChatbotInputMessages = this.canViewChatbotInputMessages(
      input.actions
    );

    if (canListAll) {
      return this.buildStatusFilter(this.visibleMenuStatuses);
    }

    const visibleBranches: IElasticsearchBoolClause[] = [
      {
        bool: {
          must: [
            {
              term: {
                status: EChatStatus.queue,
              },
            } as unknown as IElasticsearchBoolClause,
            this.buildQueueVisibilityClause(
              input.userId,
              input.userSectors,
              canViewInSector
            ),
          ],
        },
      } as unknown as IElasticsearchBoolClause,
    ];

    if (canViewOthers) {
      visibleBranches.push(
        this.buildStatusFilter([
          EChatStatus.in_chat,
          EChatStatus.ura,
          EChatStatus.ura_output,
          EChatStatus.ura_schedule,
          EChatStatus.ura_webhook,
        ])
      );
    } else {
      if (canViewChatbotInputMessages) {
        visibleBranches.push(this.buildStatusFilter([EChatStatus.ura]));
      }

      const restrictedStatuses: EChatStatus[] = [
        EChatStatus.in_chat,
        EChatStatus.ura_output,
        EChatStatus.ura_schedule,
        EChatStatus.ura_webhook,
      ];

      if (!canViewChatbotInputMessages) {
        restrictedStatuses.push(EChatStatus.ura);
      }

      visibleBranches.push({
        bool: {
          must: [
            this.buildStatusFilter(restrictedStatuses),
            canViewInSector
              ? this.buildInChatVisibilityIncludingNoSector(
                  input.userId,
                  input.userSectors
                )
              : this.buildParticipantFilter(input.userId),
          ],
        },
      } as unknown as IElasticsearchBoolClause);
    }

    return {
      bool: {
        should: visibleBranches,
        minimum_should_match: 1,
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private getUnreadCount(aggregations?: unknown): number {
    const unreadSummaryAggregations = aggregations as
      | UnreadSummaryAggregations
      | null
      | undefined;
    const value = unreadSummaryAggregations?.summary?.unread_total?.value ?? 0;

    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }

    return Math.trunc(value);
  }

  async execute(
    accountId: string,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = []
  ): Promise<ChatUnreadSummaryData> {
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
      this.buildVisibleChatsFilter({
        userId,
        actions,
        userSectors,
      }),
    ];

    const channelIds = extractUserChannelIds(userChannels);
    if (channelIds.length > 0) {
      filterClauses.push({
        nested: {
          path: 'worker',
          query: {
            terms: {
              'worker.id': channelIds,
            },
          },
        },
      } as unknown as IElasticsearchBoolClause);
    }

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.chat,
      {
        size: 0,
        track_total_hits: false,
        query: {
          bool: {
            must: mustClauses,
            filter: filterClauses,
          },
        },
        aggs: {
          summary: {
            nested: {
              path: 'summary',
            },
            aggs: {
              unread_total: {
                sum: {
                  field: 'summary.unread_count',
                },
              },
            },
          },
        },
      }
    );

    return {
      unread_count: this.getUnreadCount(result?.aggregations),
    };
  }
}
