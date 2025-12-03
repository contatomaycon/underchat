import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IUpdateAsaasPaymentRequest,
  IUpdateAsaasPaymentResponse,
} from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class UpdatePaymentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  updatePayment = async (
    paymentId: string,
    request: IUpdateAsaasPaymentRequest
  ): Promise<IUpdateAsaasPaymentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .put<IUpdateAsaasPaymentResponse>(`/v3/payments/${paymentId}`, request);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao atualizar cobrança no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao atualizar cobrança no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
