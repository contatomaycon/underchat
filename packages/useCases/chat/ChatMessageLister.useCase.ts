import { injectable, inject } from 'tsyringe';
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
import { TFunction } from 'i18next';
import { canReadChatByPolicy } from '@core/common/functions/canReadChatByPolicy';
import { ChatClosureCommentListerRepository } from '@core/repositories/chat/ChatClosureCommentLister.repository';
import { enrichMessagesWithClosureAnnotationSubtype } from '@core/common/functions/enrichMessagesWithClosureAnnotationSubtype';
import { filterMessagesForChat } from '@core/common/functions/chatMessageOwnership';

@injectable()
export class ChatMessageListerUseCase {
  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(ChatClosureCommentListerRepository)
    private readonly chatClosureCommentListerRepository: ChatClosureCommentListerRepository
  ) {}

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
    const filteredMessages = filterMessagesForChat(messages, params.chat_id);
    const droppedMessages = messages.length - filteredMessages.length;

    if (droppedMessages > 0) {
    }

    return [filteredMessages, total.value];
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

    const canReadChat = canReadChatByPolicy({
      chat,
      userId,
      actions,
      userSectors,
      userChannels,
    });

    if (!canReadChat) {
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

    const closureRows =
      await this.chatClosureCommentListerRepository.listByChatId(
        accountId,
        params.chat_id
      );
    const enrichedMessages = enrichMessagesWithClosureAnnotationSubtype(
      chatMessages,
      closureRows
    );

    const pagings = setPaginationData(
      enrichedMessages.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results: enrichedMessages,
    };
  }
}
