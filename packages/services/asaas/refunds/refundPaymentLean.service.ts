import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IRefundAsaasPaymentRequest,
  IRefundAsaasPaymentLeanResponse,
} from '@core/common/interfaces/IAsaasRefund';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class RefundPaymentLeanService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

  refundPaymentLean = async (
    paymentId: string,
    request?: IRefundAsaasPaymentRequest
  ): Promise<IRefundAsaasPaymentLeanResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<IRefundAsaasPaymentLeanResponse>(
          `/v3/lean/payments/${paymentId}/refund`,
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

        throw new Error('Erro ao estornar cobrança (lean)');
      }

      throw new Error('Erro desconhecido ao estornar cobrança (lean)');
    }
  };
}
