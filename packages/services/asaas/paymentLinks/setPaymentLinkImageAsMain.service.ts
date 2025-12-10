import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { ISetAsMainPaymentLinkImageResponse } from '@core/common/interfaces/IAsaasPaymentLink';

@injectable()
export class SetPaymentLinkImageAsMainService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  setPaymentLinkImageAsMain = async (
    paymentLinkId: string,
    imageId: string
  ): Promise<ISetAsMainPaymentLinkImageResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .put<ISetAsMainPaymentLinkImageResponse>(
          `/v3/paymentLinks/${paymentLinkId}/images/${imageId}/setAsMain`,
          {}
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao definir imagem principal do link de pagamentos no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao definir imagem principal do link de pagamentos no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
