import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasSubscriptionRequest,
  ICreateAsaasSubscriptionResponse,
} from '@core/common/interfaces/IAsaasSubscription';

@injectable()
export class CreateSubscriptionService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  createSubscription = async (
    request: ICreateAsaasSubscriptionRequest
  ): Promise<ICreateAsaasSubscriptionResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasSubscriptionResponse>('/v3/subscriptions', request);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao criar assinatura no Asaas:',
          error.response?.data
        );
      } else {
        console.error('Erro desconhecido ao criar assinatura no Asaas:', error);
      }
      return null;
    }
  };
}
