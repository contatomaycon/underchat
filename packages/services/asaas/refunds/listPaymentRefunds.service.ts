import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IListAsaasPaymentRefundsResponse } from '@core/common/interfaces/IAsaasRefund';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class ListPaymentRefundsService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  listPaymentRefunds = async (
    paymentId: string
  ): Promise<IListAsaasPaymentRefundsResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasPaymentRefundsResponse>(
          `/v3/payments/${paymentId}/refunds`
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

        throw new Error('Erro ao listar estornos da cobrança');
      }

      throw new Error('Erro desconhecido ao listar estornos da cobrança');
    }
  };
}
