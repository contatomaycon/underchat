import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { CrossSellService } from '@core/services/crossSell.service';

@injectable()
export class CrossSellDeleterUseCase {
  constructor(
    @inject(CrossSellService)
    private readonly crossSellService: CrossSellService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    crossSellId: string
  ): Promise<boolean> {
    const deleted = await this.crossSellService.deleteCrossSell(t, crossSellId);

    if (!deleted) {
      throw new Error(t('cross_sell_delete_failed'));
    }

    return true;
  }
}
