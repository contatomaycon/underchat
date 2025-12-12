import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IUploadAsaasPaymentLinkImageRequest,
  IUploadAsaasPaymentLinkImageResponse,
} from '@core/common/interfaces/IAsaasPaymentLink';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao fazer upload de imagem do link de pagamentos');
      }

      throw new Error(
        'Erro desconhecido ao fazer upload de imagem do link de pagamentos'
      );
    }
  };
}
