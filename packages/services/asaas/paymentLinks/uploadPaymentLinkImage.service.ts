import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IUploadAsaasPaymentLinkImageRequest,
  IUploadAsaasPaymentLinkImageResponse,
} from '@core/common/interfaces/IAsaasPaymentLink';

@injectable()
export class UploadPaymentLinkImageService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  uploadPaymentLinkImage = async (
    paymentLinkId: string,
    request: IUploadAsaasPaymentLinkImageRequest
  ): Promise<IUploadAsaasPaymentLinkImageResponse | null> => {
    try {
      const formData = new FormData();
      formData.append('image', request.image);

      if (request.main !== undefined) {
        formData.append('main', request.main.toString());
      }

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<IUploadAsaasPaymentLinkImageResponse>(
          `/v3/paymentLinks/${paymentLinkId}/images`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          }
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao fazer upload de imagem do link de pagamentos no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao fazer upload de imagem do link de pagamentos no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
