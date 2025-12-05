import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IDeleteAsaasSubscriptionInvoiceSettingsResponse } from '@core/common/interfaces/IAsaasSubscription';

@injectable()
export class DeleteSubscriptionInvoiceSettingsService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  deleteSubscriptionInvoiceSettings = async (
    subscriptionId: string
  ): Promise<IDeleteAsaasSubscriptionInvoiceSettingsResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .delete<IDeleteAsaasSubscriptionInvoiceSettingsResponse>(
          `/v3/subscriptions/${subscriptionId}/invoiceSettings`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao remover configuração de nota fiscal da assinatura no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao remover configuração de nota fiscal da assinatura no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
