import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { ICreateAsaasSubscriptionResponse } from '@core/common/interfaces/IAsaasSubscription';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao recuperar assinatura');
      }

      throw new Error('Erro desconhecido ao recuperar assinatura');
    }
  };
}
