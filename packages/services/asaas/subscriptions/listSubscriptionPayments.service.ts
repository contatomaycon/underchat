import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasSubscriptionPaymentsRequest,
  IListAsaasSubscriptionPaymentsResponse,
} from '@core/common/interfaces/IAsaasSubscription';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao listar cobranças da assinatura');
      }

      throw new Error('Erro desconhecido ao listar cobranças da assinatura');
    }
  };
}
