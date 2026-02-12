import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { CrossSellService } from '@core/services/crossSell.service';
import { CreateCrossSellAccountRequest } from '@core/schema/planCrossSell/createCrossSellAccount/request.schema';

@injectable()
export class CrossSellAccountCreatorUseCase {
  constructor(
    @inject(CrossSellService)
    private readonly crossSellService: CrossSellService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateCrossSellAccountRequest
  ): Promise<string> {
    if (!input.plan_cross_sell_id) {
      throw new Error(t('plan_cross_sell_id_required'));
    }

    if (!input.account_id) {
      throw new Error(t('account_id_required'));
    }

    const crossSellAccountId =
      await this.crossSellService.createCrossSellAccount(input);

    if (!crossSellAccountId) {
      throw new Error(t('cross_sell_account_creation_failed'));
    }

    return crossSellAccountId;
  }
}
