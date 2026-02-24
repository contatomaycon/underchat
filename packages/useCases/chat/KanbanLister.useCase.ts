import { injectable, inject } from 'tsyringe';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import { ListChatsResponse } from '@core/schema/chat/listChats/response.schema';
import { ListKanbanQuery } from '@core/schema/chat/listKanban/request.schema';
import {
  ListKanbanResponse,
  ListKanbanColumn,
} from '@core/schema/chat/listKanban/response.schema';
import { ChatListerUseCase } from '@core/useCases/chat/ChatLister.useCase';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';

const CHATBOT_STATUSES = [
  EChatStatus.ura,
  EChatStatus.ura_output,
  EChatStatus.ura_schedule,
  EChatStatus.ura_webhook,
];

function buildEmptyColumn(perPage: number): ListKanbanColumn {
  return {
    results: [],
    pagings: {
      current_page: 1,
      total_pages: 1,
      per_page: perPage,
      count: 0,
      total: 0,
    },
    has_more: false,
  };
}

function listResponseToColumn(response: ListChatsResponse): ListKanbanColumn {
  const pagings = response.pagings;
  return {
    results: response.results,
    pagings,
    has_more: pagings.current_page < pagings.total_pages,
  };
}

@injectable()
export class KanbanListerUseCase {
  constructor(
    @inject(ChatListerUseCase)
    private readonly chatListerUseCase: ChatListerUseCase
  ) {}

  private canViewChatbotMessages(actions: IJwtGroupHierarchy[]): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.view_chatbot_messages,
    ];
    return hasRequiredPermission(actions, permissions);
  }

  private buildListChatsQuery(
    kanbanQuery: ListKanbanQuery,
    status: string | string[],
    currentPage: number
  ): ListChatsQuery {
    const perPage = kanbanQuery.per_page ?? 50;
    const base: ListChatsQuery = {
      status: Array.isArray(status) ? status : status,
      current_page: currentPage,
      per_page: perPage,
    };
    if (kanbanQuery.filter_label_template_id !== null) {
      base.filter_label_template_id = kanbanQuery.filter_label_template_id;
    }
    if (kanbanQuery.filter_worker_id !== null) {
      base.filter_worker_id = kanbanQuery.filter_worker_id;
    }
    if (kanbanQuery.filter_sector_id !== null) {
      base.filter_sector_id = kanbanQuery.filter_sector_id;
    }
    if (kanbanQuery.filter_name !== null) {
      base.filter_name = kanbanQuery.filter_name;
    }
    if (kanbanQuery.filter_phone !== null) {
      base.filter_phone = kanbanQuery.filter_phone;
    }
    if (kanbanQuery.filter_protocol !== null) {
      base.filter_protocol = kanbanQuery.filter_protocol;
    }
    if (kanbanQuery.filter_date_start !== null) {
      base.filter_date_start = kanbanQuery.filter_date_start;
    }
    if (kanbanQuery.filter_date_end !== null) {
      base.filter_date_end = kanbanQuery.filter_date_end;
    }
    return base;
  }

  async execute(
    accountId: string,
    query: ListKanbanQuery,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = []
  ): Promise<ListKanbanResponse> {
    const perPage = query.per_page ?? 50;
    const chatbotPage = query.chatbot_page ?? 1;
    const queuePage = query.queue_page ?? 1;
    const inChatPage = query.in_chat_page ?? 1;
    const closedPage = query.closed_page ?? 1;

    const canViewChatbot = this.canViewChatbotMessages(actions);

    const chatbotQuery = canViewChatbot
      ? this.buildListChatsQuery(query, CHATBOT_STATUSES, chatbotPage)
      : null;
    const queueQuery = this.buildListChatsQuery(
      query,
      EChatStatus.queue,
      queuePage
    );
    const inChatQuery = this.buildListChatsQuery(
      query,
      EChatStatus.in_chat,
      inChatPage
    );
    const closedQuery = this.buildListChatsQuery(
      query,
      EChatStatus.closed,
      closedPage
    );

    const promises: Promise<ListChatsResponse | null>[] = [
      chatbotQuery
        ? this.chatListerUseCase.execute(
            accountId,
            chatbotQuery,
            userId,
            actions,
            userSectors,
            userChannels
          )
        : Promise.resolve(null),
      this.chatListerUseCase.execute(
        accountId,
        queueQuery,
        userId,
        actions,
        userSectors,
        userChannels
      ),
      this.chatListerUseCase.execute(
        accountId,
        inChatQuery,
        userId,
        actions,
        userSectors,
        userChannels
      ),
      this.chatListerUseCase.execute(
        accountId,
        closedQuery,
        userId,
        actions,
        userSectors,
        userChannels
      ),
    ];

    const [chatbotRes, queueRes, inChatRes, closedRes] =
      await Promise.all(promises);

    const chatbot: ListKanbanColumn =
      chatbotRes === null
        ? buildEmptyColumn(perPage)
        : listResponseToColumn(chatbotRes);

    const queue: ListKanbanColumn =
      queueRes === null
        ? buildEmptyColumn(perPage)
        : listResponseToColumn(queueRes);
    const in_chat: ListKanbanColumn =
      inChatRes === null
        ? buildEmptyColumn(perPage)
        : listResponseToColumn(inChatRes);
    const closed: ListKanbanColumn =
      closedRes === null
        ? buildEmptyColumn(perPage)
        : listResponseToColumn(closedRes);

    return {
      chatbot,
      queue,
      in_chat,
      closed,
    };
  }
}
