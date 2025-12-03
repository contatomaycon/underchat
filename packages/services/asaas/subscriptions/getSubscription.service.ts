import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { ICreateAsaasSubscriptionResponse } from '@core/common/interfaces/IAsaasSubscription';

@injectable()
export class GetSubscriptionService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getSubscription = async (
    subscriptionId: string
  ): Promise<ICreateAsaasSubscriptionResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<ICreateAsaasSubscriptionResponse>(
          `/v3/subscriptions/${subscriptionId}`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao recuperar assinatura no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao recuperar assinatura no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
