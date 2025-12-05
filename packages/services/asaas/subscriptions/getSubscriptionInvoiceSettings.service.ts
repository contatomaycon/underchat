import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { ICreateAsaasSubscriptionInvoiceSettingsResponse } from '@core/common/interfaces/IAsaasSubscription';

@injectable()
export class GetSubscriptionInvoiceSettingsService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getSubscriptionInvoiceSettings = async (
    subscriptionId: string
  ): Promise<ICreateAsaasSubscriptionInvoiceSettingsResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<ICreateAsaasSubscriptionInvoiceSettingsResponse>(
          `/v3/subscriptions/${subscriptionId}/invoiceSettings`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao recuperar configuração de nota fiscal da assinatura no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao recuperar configuração de nota fiscal da assinatura no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
