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
    const deleted =
      await this.expenditureService.deleteExpenditure(expenditureId);

    if (!deleted) {
      throw new Error(t('expenditure_delete_failed'));
    }

    return deleted;
  }
}
