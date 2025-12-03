import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IUpdateAsaasSubscriptionInvoiceSettingsRequest,
  IUpdateAsaasSubscriptionInvoiceSettingsResponse,
} from '@core/common/interfaces/IAsaasSubscription';

@injectable()
export class UpdateSubscriptionInvoiceSettingsService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  updateSubscriptionInvoiceSettings = async (
    subscriptionId: string,
    request: IUpdateAsaasSubscriptionInvoiceSettingsRequest
  ): Promise<IUpdateAsaasSubscriptionInvoiceSettingsResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .put<IUpdateAsaasSubscriptionInvoiceSettingsResponse>(
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
          'Erro ao atualizar configuração de nota fiscal da assinatura no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao atualizar configuração de nota fiscal da assinatura no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
