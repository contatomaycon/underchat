import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../../asaasBase.service';
import {
  IUpdateAsaasPaymentDocumentRequest,
  IUploadAsaasPaymentDocumentResponse,
} from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class UpdatePaymentDocumentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  updatePaymentDocument = async (
    paymentId: string,
    documentId: string,
    request: IUpdateAsaasPaymentDocumentRequest
  ): Promise<IUploadAsaasPaymentDocumentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .put<IUploadAsaasPaymentDocumentResponse>(
          `/v3/payments/${paymentId}/documents/${documentId}`,
          request
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao atualizar definições do documento da cobrança no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao atualizar definições do documento da cobrança no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
