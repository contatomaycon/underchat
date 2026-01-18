import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { MethodPaymentService } from '@core/services/methodPayment.service';
import { UpdateMethodPaymentRequest } from '@core/schema/config/updateMethodPayment/request.schema';
import { UpdateMethodPaymentResponse } from '@core/schema/config/updateMethodPayment/response.schema';

@injectable()
export class MethodPaymentUpdaterUseCase {
  constructor(
    @inject(MethodPaymentService)
    private readonly methodPaymentService: MethodPaymentService
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    input: UpdateMethodPaymentRequest
  ): Promise<UpdateMethodPaymentResponse> => {
    return this.methodPaymentService.updateMethodPayment(t, input);
  };
}
