import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IDeleteAsaasSubscriptionResponse } from '@core/common/interfaces/IAsaasSubscription';

@injectable()
export class DeleteSubscriptionService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  deleteSubscription = async (
    subscriptionId: string
  ): Promise<IDeleteAsaasSubscriptionResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .delete<IDeleteAsaasSubscriptionResponse>(
          `/v3/subscriptions/${subscriptionId}`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao remover assinatura no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao remover assinatura no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
