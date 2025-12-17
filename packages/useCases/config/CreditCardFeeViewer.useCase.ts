import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreditCardFeeService } from '@core/services/creditCardFee.service';
import { ListCreditCardFeeResponse } from '@core/schema/config/listCreditCardFee/response.schema';

@injectable()
export class CreditCardFeeViewerUseCase {
  constructor(
    @inject(CreditCardFeeService)
    private readonly creditCardFeeService: CreditCardFeeService
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>
  ): Promise<ListCreditCardFeeResponse> => {
    const creditCardFee = await this.creditCardFeeService.viewCreditCardFee();

    if (!creditCardFee) {
      throw new Error(t('credit_card_fee_not_found'));
    }

    return creditCardFee;
  };
}
