import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IDeleteAsaasPaymentResponse } from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class DeletePaymentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  deletePayment = async (
    paymentId: string
  ): Promise<IDeleteAsaasPaymentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .delete<IDeleteAsaasPaymentResponse>(`/v3/payments/${paymentId}`);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao excluir cobrança no Asaas:',
          error.response?.data
        );
      } else {
        console.error('Erro desconhecido ao excluir cobrança no Asaas:', error);
      }
      return null;
    }
  };
}
