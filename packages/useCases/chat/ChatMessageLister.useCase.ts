import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import {
  ListMessageChatsParams,
  ListMessageChatsQuery,
} from '@core/schema/chat/listMessageChats/request.schema';
import {
  ListMessageResponse,
  ListMessageResult,
} from '@core/schema/chat/listMessageChats/response.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ChatService } from '@core/services/chat.service';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { TFunction } from 'i18next';
import { IChat } from '@core/common/interfaces/IChat';

@injectable()
export class ChatMessageListerUseCase {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly chatService: ChatService
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

  private canAccessChat(
    chat: IChat,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = []
  ): boolean {
    if (userChannels.length > 0) {
      const channelIds = userChannels.map((c) => c.id);
      if (!chat.worker?.id || !channelIds.includes(chat.worker.id)) {
        return false;
      }
    }

    const canViewOthers = this.canViewOthersChats(actions);
    const canListAll = this.canListAllChatsWithoutSectorLimit(actions);
    if (canViewOthers || canListAll) return true;
    const isOwnChat = chat.user?.id === userId;
    if (isOwnChat) return true;
    const canViewInSector = this.canViewChatsInSector(actions);
    if (!canViewInSector) return false;
    if (
      userSectors.length > 0 &&
      chat.sector?.id &&
      userSectors.includes(chat.sector.id)
    )
      return true;
    if (userSectors.length === 0 && !chat.sector?.id) return true;
    if (canViewInSector && !chat.sector?.id) return true;
    return false;
  }

  private async getChatMessage(
    accountId: string,
    query: ListMessageChatsQuery,
    params: ListMessageChatsParams
  ): Promise<[ListMessageResult[], number]> {
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
      return [[], 0];
    }

    const total = result.hits.total as { value: number; relation: string };
    const messages = result.hits.hits.map(
      (hit) => hit._source
    ) as ListMessageResult[];

    return [messages, total.value];
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    query: ListMessageChatsQuery,
    params: ListMessageChatsParams,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = []
  ): Promise<ListMessageResponse> {
    const currentPage = query.current_page ?? 1;
    const perPage = query.per_page ?? 10;

    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    if (!this.canAccessChat(chat, userId, actions, userSectors, userChannels)) {
      throw new Error(t('chat_access_denied'));
    }

    const [chatMessages, total] = await this.getChatMessage(
      accountId,
      query,
      params
    );

    if (!chatMessages) {
      const pagings = setPaginationData(0, 0, perPage, currentPage);

      return {
        pagings,
        results: [],
      };
    }

    const pagings = setPaginationData(
      chatMessages.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results: chatMessages,
    };
  }
}
