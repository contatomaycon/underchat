import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasSubscriptionWithCreditCardRequest,
  ICreateAsaasSubscriptionWithCreditCardResponse,
} from '@core/common/interfaces/IAsaasSubscription';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao criar assinatura com cartão de crédito');
      }

      throw new Error(
        'Erro desconhecido ao criar assinatura com cartão de crédito'
      );
    }
  };
}
