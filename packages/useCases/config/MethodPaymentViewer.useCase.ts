import { inject, injectable } from 'tsyringe';
import { MethodPaymentService } from '@core/services/methodPayment.service';
import { ListMethodPaymentsResponse } from '@core/schema/config/listMethodPayments/response.schema';

@injectable()
export class MethodPaymentViewerUseCase {
  constructor(
    @inject(MethodPaymentService)
    private readonly methodPaymentService: MethodPaymentService
  ) {}

  execute = async (): Promise<ListMethodPaymentsResponse> => {
    const methodPayments = await this.methodPaymentService.viewMethodPayments();

    return methodPayments;
  };
}
