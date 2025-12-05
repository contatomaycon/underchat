import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { ICreateAsaasPaymentLinkResponse } from '@core/common/interfaces/IAsaasPaymentLink';

@injectable()
export class GetPaymentLinkService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getPaymentLink = async (
    paymentLinkId: string
  ): Promise<ICreateAsaasPaymentLinkResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<ICreateAsaasPaymentLinkResponse>(
          `/v3/paymentLinks/${paymentLinkId}`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao recuperar link de pagamentos no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao recuperar link de pagamentos no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
