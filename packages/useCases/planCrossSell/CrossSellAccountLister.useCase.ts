import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { CrossSellService } from '@core/services/crossSell.service';
import { ListCrossSellAccountResponse } from '@core/schema/planCrossSell/listCrossSellAccount/response.schema';

@injectable()
export class CrossSellAccountListerUseCase {
  constructor(
    @inject(CrossSellService)
    private readonly crossSellService: CrossSellService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    crossSellId: string
  ): Promise<ListCrossSellAccountResponse[]> {
    if (!crossSellId) {
      throw new Error(t('cross_sell_id_required'));
    }

    const accounts =
      await this.crossSellService.listCrossSellAccounts(crossSellId);

    return accounts;
  }
}
