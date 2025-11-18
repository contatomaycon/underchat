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
import { IChat } from '@core/common/interfaces/IChat';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ChatService } from '@core/services/chat.service';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { TFunction } from 'i18next';
import { EChatStatus } from '@core/common/enums/EChatStatus';

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
      EChatPermissions.view_others_chats,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private updateChatSummaryIfParked(chat: IChat): void {
    if (
      chat.status === EChatStatus.in_chat &&
      chat.user &&
      chat.summary?.unread_count &&
      chat.summary.unread_count > 0
    ) {
      const summaryUpdate: IChat['summary'] = {
        last_message: chat.summary.last_message,
        last_date: chat.summary.last_date,
        unread_count: 0,
      };

      this.chatService
        .updateChatSummary(chat.chat_id, summaryUpdate)
        .catch((error) => {
          console.error('Error updating chat summary:', error);
        });
    }
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
    actions: IJwtGroupHierarchy[]
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

    if (!this.canViewOthersChats(actions)) {
      if (chat.status === EChatStatus.in_chat) {
        if (chat.user?.id !== userId) {
          throw new Error(t('chat_access_denied'));
        }
      }
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

    this.updateChatSummaryIfParked(chat);

    return {
      pagings,
      results: chatMessages,
    };
  }
}
