import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasSubscriptionInvoiceSettingsRequest,
  ICreateAsaasSubscriptionInvoiceSettingsResponse,
} from '@core/common/interfaces/IAsaasSubscription';

@injectable()
export class CreateSubscriptionInvoiceSettingsService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  createSubscriptionInvoiceSettings = async (
    subscriptionId: string,
    request: ICreateAsaasSubscriptionInvoiceSettingsRequest
  ): Promise<ICreateAsaasSubscriptionInvoiceSettingsResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasSubscriptionInvoiceSettingsResponse>(
          `/v3/subscriptions/${subscriptionId}/invoiceSettings`,
          request
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao criar configuração de nota fiscal da assinatura no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao criar configuração de nota fiscal da assinatura no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
