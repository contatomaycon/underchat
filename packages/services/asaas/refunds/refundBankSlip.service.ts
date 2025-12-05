import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IRefundAsaasBankSlipResponse } from '@core/common/interfaces/IAsaasRefund';

@injectable()
export class RefundBankSlipService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  refundBankSlip = async (
    paymentId: string
  ): Promise<IRefundAsaasBankSlipResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<IRefundAsaasBankSlipResponse>(
          `/v3/payments/${paymentId}/bankSlip/refund`,
          {}
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao estornar boleto no Asaas:',
          error.response?.data
        );
      } else {
        console.error('Erro desconhecido ao estornar boleto no Asaas:', error);
      }
      return null;
    }
  };
}
