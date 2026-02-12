import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IRefundAsaasPaymentRequest } from '@core/common/interfaces/IAsaasRefund';
import { IRefundAsaasPaymentResponse } from '@core/common/interfaces/IAsaasPayment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class RefundPaymentService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

  refundPayment = async (
    paymentId: string,
    request?: IRefundAsaasPaymentRequest
  ): Promise<IRefundAsaasPaymentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<IRefundAsaasPaymentResponse>(
          `/v3/payments/${paymentId}/refund`,
          request || {}
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao estornar cobrança');
      }

      throw new Error('Erro desconhecido ao estornar cobrança');
    }
  };
}
