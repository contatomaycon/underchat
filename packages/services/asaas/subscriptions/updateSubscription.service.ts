import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IUpdateAsaasSubscriptionRequest,
  IUpdateAsaasSubscriptionResponse,
} from '@core/common/interfaces/IAsaasSubscription';

@injectable()
export class UpdateSubscriptionService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  updateSubscription = async (
    subscriptionId: string,
    request: IUpdateAsaasSubscriptionRequest
  ): Promise<IUpdateAsaasSubscriptionResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .put<IUpdateAsaasSubscriptionResponse>(
          `/v3/subscriptions/${subscriptionId}`,
          request
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao atualizar assinatura no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao atualizar assinatura no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
