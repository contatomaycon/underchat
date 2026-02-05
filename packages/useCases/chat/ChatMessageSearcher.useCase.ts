import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import {
  SearchMessagesParams,
  SearchMessagesQuery,
} from '@core/schema/chat/searchMessages/request.schema';
import {
  SearchMessagesResponse,
  SearchMessagesResult,
} from '@core/schema/chat/searchMessages/response.schema';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { IContent } from '@core/common/interfaces/IChatMessage';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';

@injectable()
export class ChatMessageSearcherUseCase {
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

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    query: SearchMessagesQuery,
    params: SearchMessagesParams,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[]
  ): Promise<SearchMessagesResponse> {
    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    const canViewOthers = this.canViewOthersChats(actions);
    const canViewInSector = this.canViewChatsInSector(actions);
    const isOwnChat = chat.user?.id === userId;
    const isChatInUserSectors =
      (userSectors.length > 0 &&
        chat.sector?.id &&
        userSectors.includes(chat.sector.id)) ||
      (userSectors.length === 0 && !chat.sector?.id);

    if (
      !canViewOthers &&
      !isOwnChat &&
      !(canViewInSector && isChatInUserSectors)
    ) {
      throw new Error(t('chat_access_denied'));
    }

    const searchTerm = query.search.trim();

    if (!searchTerm) {
      const pagings = setPaginationData(0, 0, 50, 1);
      return {
        results: [],
        pagings,
      };
    }

    const currentPage = query.current_page ?? 1;
    const perPage = query.per_page ?? 50;

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
            {
              term: {
                chat_id: params.chat_id,
              },
            },
            {
              nested: {
                path: 'content',
                query: {
                  match: {
                    'content.message': {
                      query: searchTerm,
                      operator: 'and',
                    },
                  },
                },
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<ListMessageResult>(
      EElasticIndex.message,
      queryElastic
    );

    if (!result) {
      const pagings = setPaginationData(0, 0, perPage, currentPage);
      return {
        results: [],
        pagings,
      };
    }

    const total = result.hits.total as { value: number; relation: string };
    const messages: SearchMessagesResult[] = [];

    for (const hit of result.hits.hits) {
      const message = hit._source as ListMessageResult;

      if (!message.content) {
        continue;
      }

      const messageText = extractMessageTextFromContent(
        message.content as IContent
      );

      messages.push({
        message_id: message.message_id,
        date: message.date,
        message: messageText ?? null,
      });
    }

    const pagings = setPaginationData(
      messages.length,
      total.value,
      perPage,
      currentPage
    );

    return {
      results: messages,
      pagings,
    };
  }
}
