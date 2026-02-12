import { injectable, inject } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListMessageTemplateFinalResponse } from '@core/schema/messageTemplate/listMessageTemplate/response.schema';
import { MessageTemplateService } from '@core/services/messageTemplate.service';
import { ListMessageTemplateRequest } from '@core/schema/messageTemplate/listMessageTemplate/request.schema';

@injectable()
export class MessageTemplateListerUseCase {
  constructor(
    @inject(MessageTemplateService)
    private readonly messageTemplateService: MessageTemplateService
  ) {}

  async execute(
    query: ListMessageTemplateRequest,
    accountId: string
  ): Promise<ListMessageTemplateFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] =
      await this.messageTemplateService.listMessageTemplates(
        perPage,
        currentPage,
        query,
        accountId
      );

    const pagings = setPaginationData(
      results.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results,
    };
  }
}
