import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreditCardFeeService } from '@core/services/creditCardFee.service';
import { UpdateCreditCardFeeRequest } from '@core/schema/config/updateCreditCardFee/request.schema';
import { UpdateCreditCardFeeResponse } from '@core/schema/config/updateCreditCardFee/response.schema';

@injectable()
export class CreditCardFeeUpserterUseCase {
  constructor(
    @inject(CreditCardFeeService)
    private readonly creditCardFeeService: CreditCardFeeService
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    input: UpdateCreditCardFeeRequest
  ): Promise<UpdateCreditCardFeeResponse> => {
    return this.creditCardFeeService.upsertCreditCardFee(t, input);
  };
}
