import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasSubscriptionPaymentsRequest,
  IListAsaasSubscriptionPaymentsResponse,
} from '@core/common/interfaces/IAsaasSubscription';

@injectable()
export class ListSubscriptionPaymentsService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  listSubscriptionPayments = async (
    subscriptionId: string,
    request?: IListAsaasSubscriptionPaymentsRequest
  ): Promise<IListAsaasSubscriptionPaymentsResponse | null> => {
    try {
      const params = new URLSearchParams();

      if (request?.status) {
        params.append('status', request.status);
      }

      const queryString = params.toString();
      const url = queryString
        ? `/v3/subscriptions/${subscriptionId}/payments?${queryString}`
        : `/v3/subscriptions/${subscriptionId}/payments`;

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasSubscriptionPaymentsResponse>(url);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao listar cobranças da assinatura no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao listar cobranças da assinatura no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
