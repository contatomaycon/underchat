import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { ICreateAsaasPaymentResponse } from '@core/common/interfaces/IAsaasPayment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class GetPaymentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getPayment = async (
    paymentId: string
  ): Promise<ICreateAsaasPaymentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<ICreateAsaasPaymentResponse>(`/v3/payments/${paymentId}`);

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

        throw new Error('Erro ao recuperar cobrança');
      }

      throw new Error('Erro desconhecido ao recuperar cobrança');
    }
  };
}
