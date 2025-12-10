import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IDeleteAsaasPaymentLinkResponse } from '@core/common/interfaces/IAsaasPaymentLink';

@injectable()
export class DeletePaymentLinkService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  deletePaymentLink = async (
    paymentLinkId: string
  ): Promise<IDeleteAsaasPaymentLinkResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .delete<IDeleteAsaasPaymentLinkResponse>(
          `/v3/paymentLinks/${paymentLinkId}`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao remover link de pagamentos no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao remover link de pagamentos no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
