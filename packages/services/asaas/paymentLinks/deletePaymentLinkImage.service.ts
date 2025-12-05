import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IDeleteAsaasPaymentLinkImageResponse } from '@core/common/interfaces/IAsaasPaymentLink';

@injectable()
export class DeletePaymentLinkImageService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  deletePaymentLinkImage = async (
    paymentLinkId: string,
    imageId: string
  ): Promise<IDeleteAsaasPaymentLinkImageResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .delete<IDeleteAsaasPaymentLinkImageResponse>(
          `/v3/paymentLinks/${paymentLinkId}/images/${imageId}`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao remover imagem do link de pagamentos no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao remover imagem do link de pagamentos no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
