import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IRefundAsaasPaymentRequest,
  IRefundAsaasPaymentLeanResponse,
} from '@core/common/interfaces/IAsaasRefund';

@injectable()
export class RefundPaymentLeanService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

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
        console.error(
          'Erro ao estornar cobrança (lean) no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao estornar cobrança (lean) no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
