import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListMessageTemplateFinalResponse } from '@core/schema/messageTemplate/listMessageTemplate/response.schema';
import { MessageTemplateService } from '@core/services/messageTemplate.service';
import { ListMessageTemplateRequest } from '@core/schema/messageTemplate/listMessageTemplate/request.schema';

@injectable()
export class MessageTemplateListerUseCase {
  constructor(
    private readonly messageTemplateService: MessageTemplateService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListMessageTemplateRequest,
    isAdministrator: boolean,
    accountId: string
  ): Promise<ListMessageTemplateFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] =
      await this.messageTemplateService.listMessageTemplates(
        perPage,
        currentPage,
        query,
        isAdministrator,
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
