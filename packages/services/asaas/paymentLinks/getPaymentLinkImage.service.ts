import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IUploadAsaasPaymentLinkImageResponse } from '@core/common/interfaces/IAsaasPaymentLink';

@injectable()
export class GetPaymentLinkImageService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getPaymentLinkImage = async (
    paymentLinkId: string,
    imageId: string
  ): Promise<IUploadAsaasPaymentLinkImageResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IUploadAsaasPaymentLinkImageResponse>(
          `/v3/paymentLinks/${paymentLinkId}/images/${imageId}`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao recuperar imagem do link de pagamentos no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao recuperar imagem do link de pagamentos no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
