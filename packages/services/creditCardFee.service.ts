import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreditCardFeeViewerRepository } from '@core/repositories/config/CreditCardFeeViewer.repository';
import { CreditCardFeeUpdaterRepository } from '@core/repositories/config/CreditCardFeeUpdater.repository';
import { ListCreditCardFeeResponse } from '@core/schema/config/listCreditCardFee/response.schema';
import { UpdateCreditCardFeeRequest } from '@core/schema/config/updateCreditCardFee/request.schema';
import { UpdateCreditCardFeeResponse } from '@core/schema/config/updateCreditCardFee/response.schema';

@injectable()
export class CreditCardFeeService {
  constructor(
    private readonly creditCardFeeViewerRepository: CreditCardFeeViewerRepository,
    private readonly creditCardFeeUpdaterRepository: CreditCardFeeUpdaterRepository
  ) {}

  viewCreditCardFee = async (): Promise<ListCreditCardFeeResponse | null> => {
    return this.creditCardFeeViewerRepository.viewCreditCardFee();
  };

  upsertCreditCardFee = async (
    t: TFunction<'translation', undefined>,
    input: UpdateCreditCardFeeRequest
  ): Promise<UpdateCreditCardFeeResponse> => {
    return this.creditCardFeeUpdaterRepository.upsertCreditCardFee(t, input);
  };
}
