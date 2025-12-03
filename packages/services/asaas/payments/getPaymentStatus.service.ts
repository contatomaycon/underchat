import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IGetAsaasPaymentStatusResponse } from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class GetPaymentStatusService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getPaymentStatus = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentStatusResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IGetAsaasPaymentStatusResponse>(
          `/v3/payments/${paymentId}/status`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao recuperar status da cobrança no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao recuperar status da cobrança no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
