import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateExpenditureRequest } from '@core/schema/expenditure/editExpenditure/request.schema';
import { ExpenditureService } from '@core/services/expenditure.service';

@injectable()
export class ExpenditureUpdaterUseCase {
  constructor(private readonly expenditureService: ExpenditureService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    expenditureId: string,
    body: UpdateExpenditureRequest
  ): Promise<boolean> {
    const expenditureExists =
      await this.expenditureService.existsExpenditureById(expenditureId);

    if (!expenditureExists) {
      throw new Error(t('expenditure_not_found'));
    }

    const expenditureUpdater =
      await this.expenditureService.updateExpenditureById(body, expenditureId);

    if (!expenditureUpdater) {
      throw new Error(t('expenditure_update_error'));
    }

    return expenditureUpdater;
  }
}
