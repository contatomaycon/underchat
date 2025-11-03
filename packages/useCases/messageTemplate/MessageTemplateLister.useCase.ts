import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListAccountRequest } from '@core/schema/account/listAccount/request.schema';
import { ListMessageTemplateFinalResponse } from '@core/schema/messageTemplate/listMessageTemplate/response.schema';
import { MessageTemplateService } from '@core/services/messageTemplate.service';

@injectable()
export class MessageTemplateListerUseCase {
  constructor(
    private readonly messageTemplateService: MessageTemplateService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListAccountRequest,
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
