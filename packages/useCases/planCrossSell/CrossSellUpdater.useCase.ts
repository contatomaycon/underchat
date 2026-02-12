import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { CrossSellService } from '@core/services/crossSell.service';
import { UpdateCrossSellRequest } from '@core/schema/planCrossSell/updateCrossSell/request.schema';

@injectable()
export class CrossSellUpdaterUseCase {
  constructor(
    @inject(CrossSellService)
    private readonly crossSellService: CrossSellService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    crossSellId: string,
    input: UpdateCrossSellRequest
  ): Promise<boolean> {
    if (input.quantity !== undefined && input.quantity <= 0) {
      throw new Error(t('cross_sell_quantity_invalid'));
    }

    if (input.price !== undefined && input.price < 0) {
      throw new Error(t('cross_sell_price_invalid'));
    }

    const updated = await this.crossSellService.updateCrossSell(
      crossSellId,
      input
    );

    if (!updated) {
      throw new Error(t('cross_sell_update_failed'));
    }

    return true;
  }
}
