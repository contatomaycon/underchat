import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../../asaasBase.service';
import { IUploadAsaasPaymentDocumentResponse } from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class GetPaymentDocumentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getPaymentDocument = async (
    paymentId: string,
    documentId: string
  ): Promise<IUploadAsaasPaymentDocumentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IUploadAsaasPaymentDocumentResponse>(
          `/v3/payments/${paymentId}/documents/${documentId}`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao recuperar documento da cobrança no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao recuperar documento da cobrança no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
