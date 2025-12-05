import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../../asaasBase.service';
import {
  IUploadAsaasPaymentDocumentRequest,
  IUploadAsaasPaymentDocumentResponse,
} from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class UploadPaymentDocumentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  uploadPaymentDocument = async (
    paymentId: string,
    request: IUploadAsaasPaymentDocumentRequest
  ): Promise<IUploadAsaasPaymentDocumentResponse | null> => {
    try {
      const formData = new FormData();
      formData.append('file', request.file);
      formData.append('type', request.type);
      formData.append(
        'availableAfterPayment',
        String(request.availableAfterPayment)
      );

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<IUploadAsaasPaymentDocumentResponse>(
          `/v3/payments/${paymentId}/documents`,
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
          'Erro ao fazer upload de documento da cobrança no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao fazer upload de documento da cobrança no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
