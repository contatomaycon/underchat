import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatListerUseCase } from '@core/useCases/chat/ChatLister.useCase';
import { ChatSearcherUseCase } from '@core/useCases/chat/ChatSearcher.useCase';
import { TransferChatUseCase } from '@core/useCases/chat/TransferChat.useCase';
import { ChatStatusUpdaterUseCase } from '@core/useCases/chat/ChatStatusUpdater.useCase';
import {
  BulkActionChatRequest,
  BULK_CHAT_CATEGORIES,
} from '@core/schema/chat/bulkAction/request.schema';
import { BulkActionChatResponse } from '@core/schema/chat/bulkAction/response.schema';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import {
  MY_CHATS_STATUS,
  ListChatsQuery,
} from '@core/schema/chat/listChats/request.schema';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { SearchChatsQuery } from '@core/schema/chat/searchChats/request.schema';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';

type BulkCategory = (typeof BULK_CHAT_CATEGORIES)[number];

type BulkFailure = BulkActionChatResponse['failures'][number];

type BulkListFilters = Pick<
  BulkActionChatRequest,
  | 'filter_label_template_id'
  | 'filter_worker_id'
  | 'filter_user_id'
  | 'filter_sector_id'
  | 'filter_name'
  | 'filter_phone'
  | 'filter_protocol'
  | 'filter_date_start'
  | 'filter_date_end'
  | 'filter_unread_conversations'
>;

@injectable()
export class ChatBulkActionUseCase {
  private static readonly PAGE_SIZE = 200;

  constructor(
    @inject(ChatListerUseCase)
    private readonly chatListerUseCase: ChatListerUseCase,
    @inject(ChatSearcherUseCase)
    private readonly chatSearcherUseCase: ChatSearcherUseCase,
    @inject(TransferChatUseCase)
    private readonly transferChatUseCase: TransferChatUseCase,
    @inject(ChatStatusUpdaterUseCase)
    private readonly chatStatusUpdaterUseCase: ChatStatusUpdaterUseCase
  ) {}

  private shouldUseSearchEndpoint(input: BulkActionChatRequest): boolean {
    const search = input.search?.trim() ?? '';
    return input.has_applied_advanced_filters === true || search.length > 0;
  }

  private resolveStatusByCategory(
    category: BulkCategory
  ): EChatStatus | EChatStatus[] | typeof MY_CHATS_STATUS {
    switch (category) {
      case 'all':
        return [EChatStatus.in_chat, EChatStatus.queue];
      case 'in_chat':
        return EChatStatus.in_chat;
      case 'queue':
        return EChatStatus.queue;
      case 'my_chats':
        return MY_CHATS_STATUS;
      case 'chatbot':
        return [
          EChatStatus.ura,
          EChatStatus.ura_output,
          EChatStatus.ura_webhook,
        ];
      case 'scheduled':
        return EChatStatus.ura_schedule;
      default:
        return [EChatStatus.in_chat, EChatStatus.queue];
    }
  }

  private isStatusEligibleForCategory(
    status: EChatStatus,
    category: BulkCategory
  ): boolean {
    switch (category) {
      case 'all':
        return status === EChatStatus.in_chat || status === EChatStatus.queue;
      case 'in_chat':
        return status === EChatStatus.in_chat;
      case 'queue':
        return status === EChatStatus.queue;
      case 'my_chats':
        return status === EChatStatus.in_chat || status === EChatStatus.queue;
      case 'chatbot':
        return (
          status === EChatStatus.ura ||
          status === EChatStatus.ura_output ||
          status === EChatStatus.ura_webhook
        );
      case 'scheduled':
        return status === EChatStatus.ura_schedule;
      default:
        return false;
    }
  }

  private buildSharedFilters(input: BulkActionChatRequest): BulkListFilters {
    return {
      filter_label_template_id: input.filter_label_template_id ?? undefined,
      filter_worker_id: input.filter_worker_id ?? undefined,
      filter_user_id: input.filter_user_id ?? undefined,
      filter_sector_id: input.filter_sector_id ?? undefined,
      filter_name: input.filter_name ?? undefined,
      filter_phone: input.filter_phone ?? undefined,
      filter_protocol: input.filter_protocol ?? undefined,
      filter_date_start: input.filter_date_start ?? undefined,
      filter_date_end: input.filter_date_end ?? undefined,
      filter_unread_conversations:
        input.filter_unread_conversations ?? undefined,
    };
  }

  private buildSearchQuery(
    input: BulkActionChatRequest,
    status: EChatStatus | EChatStatus[] | typeof MY_CHATS_STATUS,
    currentPage: number
  ): SearchChatsQuery {
    return {
      current_page: currentPage,
      per_page: ChatBulkActionUseCase.PAGE_SIZE,
      search: input.search?.trim() ?? '',
      status,
      ...this.buildSharedFilters(input),
      sort_field: input.sort_field ?? undefined,
      sort_order: input.sort_order ?? undefined,
    };
  }

  private buildListQuery(
    input: BulkActionChatRequest,
    status: EChatStatus | EChatStatus[] | typeof MY_CHATS_STATUS,
    currentPage: number
  ): ListChatsQuery {
    return {
      current_page: currentPage,
      per_page: ChatBulkActionUseCase.PAGE_SIZE,
      status,
      ...this.buildSharedFilters(input),
    };
  }

  private async collectFilteredChatIds(
    accountId: string,
    userId: string,
    input: BulkActionChatRequest,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[]
  ): Promise<string[]> {
    const category = input.category as BulkCategory;
    const status = this.resolveStatusByCategory(category);
    const shouldUseSearch = this.shouldUseSearchEndpoint(input);

    const chatIds = new Set<string>();
    let currentPage = 1;
    let totalPages = 1;

    do {
      if (shouldUseSearch) {
        const searchResult = await this.chatSearcherUseCase.execute(
          accountId,
          this.buildSearchQuery(input, status, currentPage),
          userId,
          actions,
          userSectors,
          userChannels
        );

        for (const chat of searchResult.results) {
          if (
            chat.chat_id &&
            this.isStatusEligibleForCategory(
              chat.status as EChatStatus,
              category
            )
          ) {
            chatIds.add(chat.chat_id);
          }
        }

        totalPages = searchResult.pagings.total_pages || 1;
      } else {
        const listResult = await this.chatListerUseCase.execute(
          accountId,
          this.buildListQuery(input, status, currentPage),
          userId,
          actions,
          userSectors,
          userChannels
        );

        for (const chat of listResult.results) {
          if (
            chat.chat_id &&
            this.isStatusEligibleForCategory(
              chat.status as EChatStatus,
              category
            )
          ) {
            chatIds.add(chat.chat_id);
          }
        }

        totalPages = listResult.pagings.total_pages || 1;
      }

      currentPage += 1;
    } while (currentPage <= totalPages);

    return Array.from(chatIds);
  }

  private normalizeSelectedChatIds(input: BulkActionChatRequest): string[] {
    const source = input.chat_ids ?? [];
    const ids = new Set<string>();

    for (const chatId of source) {
      const normalized = typeof chatId === 'string' ? chatId.trim() : '';
      if (normalized.length > 0) {
        ids.add(normalized);
      }
    }

    return Array.from(ids);
  }

  private validateInput(
    t: TFunction<'translation', undefined>,
    input: BulkActionChatRequest
  ): void {
    if (input.selection_mode === 'selected') {
      if (!input.chat_ids || input.chat_ids.length === 0) {
        throw new Error(t('chat_bulk_ids_required'));
      }
    }

    if (input.selection_mode === 'filtered') {
      if (!input.category) {
        throw new Error(t('chat_bulk_category_required'));
      }
    }

    if (input.action === 'transfer') {
      if (!input.transfer_payload?.worker_id) {
        throw new Error(t('channel_required'));
      }
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    actorUserId: string,
    permissionRoleId: string | null,
    input: BulkActionChatRequest,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[],
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<BulkActionChatResponse> {
    this.validateInput(t, input);

    const targetChatIds =
      input.selection_mode === 'selected'
        ? this.normalizeSelectedChatIds(input)
        : await this.collectFilteredChatIds(
            accountId,
            actorUserId,
            input,
            actions,
            userSectors,
            userChannels
          );

    const failures: BulkFailure[] = [];
    let successCount = 0;

    for (const chatId of targetChatIds) {
      try {
        if (input.action === 'transfer') {
          const transferPayload = input.transfer_payload ?? {};

          await this.transferChatUseCase.execute(
            t,
            accountId,
            { chat_id: chatId },
            {
              worker_id: transferPayload.worker_id,
              user_id: transferPayload.user_id,
              sector_id: transferPayload.sector_id,
              annotation: transferPayload.annotation,
              keep_in_chat: transferPayload.keep_in_chat ?? false,
              send_message_on_transfer:
                transferPayload.send_message_on_transfer,
            },
            actorUserId,
            permissionRoleId,
            actions,
            userChannels,
            webhookSource
          );

          successCount += 1;
          continue;
        }

        const closeResult = await this.chatStatusUpdaterUseCase.execute(
          t,
          accountId,
          actorUserId,
          permissionRoleId,
          userSectors,
          { chat_id: chatId },
          {
            status: EChatStatus.closed,
            send_message_on_finish_attendance:
              input.close_payload?.send_message_on_finish_attendance ?? true,
          },
          actions,
          userChannels,
          { skipClosureCommentValidation: true },
          webhookSource
        );

        if (!closeResult) {
          failures.push({
            chat_id: chatId,
            message: t('chat_status_update_not_found'),
          });
          continue;
        }

        successCount += 1;
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : t('chat_bulk_action_item_failed');

        failures.push({
          chat_id: chatId,
          message,
        });
      }
    }

    return {
      total_targeted: targetChatIds.length,
      success_count: successCount,
      failed_count: failures.length,
      failures,
    };
  }
}
