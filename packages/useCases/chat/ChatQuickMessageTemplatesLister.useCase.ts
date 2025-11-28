import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { ListQuickMessageTemplatesRequest } from '@core/schema/chat/listQuickMessageTemplates/request.schema';
import { ListQuickMessageTemplatesFinalResponse } from '@core/schema/chat/listQuickMessageTemplates/response.schema';

@injectable()
export class ChatQuickMessageTemplatesListerUseCase {
  constructor(private readonly chatService: ChatService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListQuickMessageTemplatesRequest,
    accountId: string
  ): Promise<ListQuickMessageTemplatesFinalResponse> {
    const results = await this.chatService.listQuickMessageTemplates(
      query,
      accountId
    );

    return {
      results,
    };
  }
}
