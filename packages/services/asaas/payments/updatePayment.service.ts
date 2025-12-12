import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IUpdateAsaasPaymentRequest,
  IUpdateAsaasPaymentResponse,
} from '@core/common/interfaces/IAsaasPayment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao atualizar cobrança');
      }

      throw new Error('Erro desconhecido ao atualizar cobrança');
    }
  };
}
