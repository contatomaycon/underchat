import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IUpdateAsaasSubscriptionCreditCardRequest,
  IUpdateAsaasSubscriptionCreditCardResponse,
} from '@core/common/interfaces/IAsaasSubscription';

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
        console.error(
          'Erro ao atualizar cartão de crédito da assinatura no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao atualizar cartão de crédito da assinatura no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
