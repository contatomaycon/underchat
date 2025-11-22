import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CrossSellService } from '@core/services/crossSell.service';

@injectable()
export class CrossSellAccountDeleterUseCase {
  constructor(private readonly crossSellService: CrossSellService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    crossSellAccountId: string
  ): Promise<boolean> {
    const deleted =
      await this.crossSellService.deleteCrossSellAccount(crossSellAccountId);

    if (!deleted) {
      throw new Error(t('cross_sell_account_delete_failed'));
    }

    return true;
  }
}
