import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IUpdateAsaasSubscriptionRequest,
  IUpdateAsaasSubscriptionResponse,
} from '@core/common/interfaces/IAsaasSubscription';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao atualizar assinatura');
      }

      throw new Error('Erro desconhecido ao atualizar assinatura');
    }
  };
}
