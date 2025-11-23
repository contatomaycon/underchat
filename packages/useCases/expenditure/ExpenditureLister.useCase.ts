import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListExpenditureRequest } from '@core/schema/expenditure/listExpenditure/request.schema';
import { ListExpenditureFinalResponse } from '@core/schema/expenditure/listExpenditure/response.schema';
import { ExpenditureService } from '@core/services/expenditure.service';

@injectable()
export class ExpenditureListerUseCase {
  constructor(private readonly expenditureService: ExpenditureService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListExpenditureRequest
  ): Promise<ListExpenditureFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.expenditureService.listExpenditures(
      perPage,
      currentPage,
      query
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
