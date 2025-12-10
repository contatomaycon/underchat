import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IRestoreAsaasPaymentLinkResponse } from '@core/common/interfaces/IAsaasPaymentLink';

@injectable()
export class RestorePaymentLinkService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  restorePaymentLink = async (
    paymentLinkId: string
  ): Promise<IRestoreAsaasPaymentLinkResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<IRestoreAsaasPaymentLinkResponse>(
          `/v3/paymentLinks/${paymentLinkId}/restore`,
          {}
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao restaurar link de pagamentos no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao restaurar link de pagamentos no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
