import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ExpenditureService } from '@core/services/expenditure.service';
import { UpdateExpenditureRequest } from '@core/schema/expenditure/updateExpenditure/request.schema';

@injectable()
export class ExpenditureUpdaterUseCase {
  constructor(private readonly expenditureService: ExpenditureService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    expenditureId: string,
    input: UpdateExpenditureRequest
  ): Promise<boolean> {
    if (input.name !== null && input.name !== undefined) {
      if (input.name.trim().length === 0) {
        throw new Error(t('expenditure_name_required'));
      }
    }

    if (input.price !== null && input.price !== undefined) {
      if (input.price < 0) {
        throw new Error(t('expenditure_price_invalid'));
      }
    }

    const updated = await this.expenditureService.updateExpenditure(
      expenditureId,
      input
    );

    if (!updated) {
      throw new Error(t('expenditure_update_failed'));
    }

    return updated;
  }
}
