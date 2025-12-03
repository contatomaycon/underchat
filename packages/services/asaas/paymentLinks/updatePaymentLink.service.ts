import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IUpdateAsaasPaymentLinkRequest,
  IUpdateAsaasPaymentLinkResponse,
} from '@core/common/interfaces/IAsaasPaymentLink';

@injectable()
export class UpdatePaymentLinkService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  updatePaymentLink = async (
    paymentLinkId: string,
    request: IUpdateAsaasPaymentLinkRequest
  ): Promise<IUpdateAsaasPaymentLinkResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .put<IUpdateAsaasPaymentLinkResponse>(
          `/v3/paymentLinks/${paymentLinkId}`,
          request
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao atualizar link de pagamentos no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao atualizar link de pagamentos no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
