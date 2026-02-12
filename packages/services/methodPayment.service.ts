import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { MethodPaymentViewerRepository } from '@core/repositories/config/MethodPaymentViewer.repository';
import { MethodPaymentUpdaterRepository } from '@core/repositories/config/MethodPaymentUpdater.repository';
import { ListMethodPaymentsResponse } from '@core/schema/config/listMethodPayments/response.schema';
import { UpdateMethodPaymentRequest } from '@core/schema/config/updateMethodPayment/request.schema';
import { UpdateMethodPaymentResponse } from '@core/schema/config/updateMethodPayment/response.schema';
import { EMethodPayment } from '@core/common/enums/EMethodPayment';

@injectable()
export class MethodPaymentService {
  constructor(
    @inject(MethodPaymentViewerRepository)
    private readonly methodPaymentViewerRepository: MethodPaymentViewerRepository,
    @inject(MethodPaymentUpdaterRepository)
    private readonly methodPaymentUpdaterRepository: MethodPaymentUpdaterRepository
  ) {}

  viewMethodPayments = async (): Promise<ListMethodPaymentsResponse> => {
    return this.methodPaymentViewerRepository.viewMethodPayments();
  };

  viewMethodPaymentByType = async (
    type: string
  ): Promise<ListMethodPaymentsResponse[0] | null> => {
    return this.methodPaymentViewerRepository.viewMethodPaymentByType(
      type as EMethodPayment
    );
  };

  updateMethodPayment = async (
    t: TFunction<'translation', undefined>,
    input: UpdateMethodPaymentRequest
  ): Promise<UpdateMethodPaymentResponse> => {
    return this.methodPaymentUpdaterRepository.updateMethodPayment(t, input);
  };
}
