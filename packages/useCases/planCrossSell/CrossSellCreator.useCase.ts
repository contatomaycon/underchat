import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CrossSellService } from '@core/services/crossSell.service';
import { CreateCrossSellRequest } from '@core/schema/planCrossSell/createCrossSell/request.schema';

@injectable()
export class CrossSellCreatorUseCase {
  constructor(private readonly crossSellService: CrossSellService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateCrossSellRequest
  ): Promise<string> {
    if (!input.plan_product_id) {
      throw new Error(t('plan_product_id_required'));
    }

    if (input.quantity <= 0) {
      throw new Error(t('cross_sell_quantity_invalid'));
    }

    if (input.price < 0) {
      throw new Error(t('cross_sell_price_invalid'));
    }

    const crossSellId = await this.crossSellService.createCrossSell(input);

    if (!crossSellId) {
      throw new Error(t('cross_sell_creation_failed'));
    }

    return crossSellId;
  }
}
