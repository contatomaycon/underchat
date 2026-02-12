import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IDeleteAsaasSubscriptionInvoiceSettingsResponse } from '@core/common/interfaces/IAsaasSubscription';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class DeleteSubscriptionInvoiceSettingsService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error(
          'Erro ao remover configuração de nota fiscal da assinatura'
        );
      }

      throw new Error(
        'Erro desconhecido ao remover configuração de nota fiscal da assinatura'
      );
    }
  };
}
