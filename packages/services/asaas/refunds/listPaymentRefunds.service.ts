import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IListAsaasPaymentRefundsResponse } from '@core/common/interfaces/IAsaasRefund';

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
        console.error(
          'Erro ao listar estornos da cobrança no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao listar estornos da cobrança no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
