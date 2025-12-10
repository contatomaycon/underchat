import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IRefundAsaasPaymentRequest } from '@core/common/interfaces/IAsaasRefund';
import { IRefundAsaasPaymentResponse } from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class RefundPaymentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

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
        console.error(
          'Erro ao estornar cobrança no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao estornar cobrança no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
