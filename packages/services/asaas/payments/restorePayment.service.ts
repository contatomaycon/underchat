import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { ICreateAsaasPaymentResponse } from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class RestorePaymentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  restorePayment = async (
    paymentId: string
  ): Promise<ICreateAsaasPaymentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasPaymentResponse>(
          `/v3/payments/${paymentId}/restore`,
          {}
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao restaurar cobrança removida no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao restaurar cobrança removida no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
