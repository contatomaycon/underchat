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
  ): Promise<boolean> {
    const createExpenditure =
      await this.expenditureService.createExpenditure(input);

    if (!createExpenditure) {
      throw new Error(t('expenditure_creation_failed'));
    }

    return true;
  }
}
