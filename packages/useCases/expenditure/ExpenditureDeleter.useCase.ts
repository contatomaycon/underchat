import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ExpenditureService } from '@core/services/expenditure.service';

@injectable()
export class ExpenditureDeleterUseCase {
  constructor(private readonly expenditureService: ExpenditureService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    expenditureId: string
  ): Promise<boolean> {
    const expenditureExists =
      await this.expenditureService.existsExpenditureById(expenditureId);

    if (!expenditureExists) {
      throw new Error(t('expenditure_not_found'));
    }

    const expenditureDeleted =
      await this.expenditureService.deleteExpenditureById(expenditureId);

    if (!expenditureDeleted) {
      throw new Error(t('expenditure_deleter_error'));
    }

    return true;
  }
}
