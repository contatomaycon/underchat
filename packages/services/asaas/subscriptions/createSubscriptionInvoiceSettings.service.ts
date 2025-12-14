import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasSubscriptionInvoiceSettingsRequest,
  ICreateAsaasSubscriptionInvoiceSettingsResponse,
} from '@core/common/interfaces/IAsaasSubscription';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error(
          'Erro ao criar configuração de nota fiscal da assinatura'
        );
      }

      throw new Error(
        'Erro desconhecido ao criar configuração de nota fiscal da assinatura'
      );
    }
  };
}
