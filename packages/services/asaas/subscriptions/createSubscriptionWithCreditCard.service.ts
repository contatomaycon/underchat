import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasSubscriptionWithCreditCardRequest,
  ICreateAsaasSubscriptionWithCreditCardResponse,
} from '@core/common/interfaces/IAsaasSubscription';

@injectable()
export class CreateSubscriptionWithCreditCardService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  createSubscriptionWithCreditCard = async (
    request: ICreateAsaasSubscriptionWithCreditCardRequest
  ): Promise<ICreateAsaasSubscriptionWithCreditCardResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasSubscriptionWithCreditCardResponse>(
          '/v3/subscriptions/',
          request
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao criar assinatura com cartão de crédito no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao criar assinatura com cartão de crédito no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
