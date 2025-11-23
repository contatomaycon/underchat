import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ExpenditureService } from '@core/services/expenditure.service';
import { CreateExpenditureRequest } from '@core/schema/expenditure/createExpenditure/request.schema';

@injectable()
export class ExpenditureCreatorUseCase {
  constructor(private readonly expenditureService: ExpenditureService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateExpenditureRequest
  ): Promise<string> {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error(t('expenditure_name_required'));
    }

    if (input.price < 0) {
      throw new Error(t('expenditure_price_invalid'));
    }

    const expenditureId =
      await this.expenditureService.createExpenditure(input);

    if (!expenditureId) {
      throw new Error(t('expenditure_creation_failed'));
    }

    return expenditureId;
  }
}
