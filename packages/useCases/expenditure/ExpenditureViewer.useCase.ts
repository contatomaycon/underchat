import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ExpenditureService } from '@core/services/expenditure.service';
import { ViewExpenditureResponse } from '@core/schema/expenditure/viewExpenditure/response.schema';

@injectable()
export class ExpenditureViewerUseCase {
  constructor(private readonly expenditureService: ExpenditureService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    expenditureId: string
  ): Promise<ViewExpenditureResponse | null> {
    const expenditureExists =
      await this.expenditureService.existsExpenditureById(expenditureId);

    if (!expenditureExists) {
      throw new Error(t('expenditure_not_found'));
    }

    const viewExpenditure =
      await this.expenditureService.viewExpenditure(expenditureId);

    if (!viewExpenditure) {
      throw new Error(t('expenditure_not_found'));
    }

    return viewExpenditure;
  }
}
