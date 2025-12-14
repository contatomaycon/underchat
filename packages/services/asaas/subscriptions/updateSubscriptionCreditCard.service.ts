import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IUpdateAsaasSubscriptionCreditCardRequest,
  IUpdateAsaasSubscriptionCreditCardResponse,
} from '@core/common/interfaces/IAsaasSubscription';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class UpdateSubscriptionCreditCardService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  updateSubscriptionCreditCard = async (
    subscriptionId: string,
    request: IUpdateAsaasSubscriptionCreditCardRequest
  ): Promise<IUpdateAsaasSubscriptionCreditCardResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .put<IUpdateAsaasSubscriptionCreditCardResponse>(
          `/v3/subscriptions/${subscriptionId}/creditCard`,
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

        throw new Error('Erro ao atualizar cartão de crédito da assinatura');
      }

      throw new Error(
        'Erro desconhecido ao atualizar cartão de crédito da assinatura'
      );
    }
  };
}
