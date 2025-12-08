import { injectable } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListLabelTemplateRequest } from '@core/schema/labelTemplate/listLabelTemplate/request.schema';
import { ListLabelTemplateFinalResponse } from '@core/schema/labelTemplate/listLabelTemplate/response.schema';
import { LabelTemplateService } from '@core/services/labelTemplate.service';

@injectable()
export class LabelTemplateListerUseCase {
  constructor(private readonly labelTemplateService: LabelTemplateService) {}

  async execute(
    query: ListLabelTemplateRequest,
    accountId: string
  ): Promise<ListLabelTemplateFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.labelTemplateService.listLabelTemplates(
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
