import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../../asaasBase.service';
import { IDeleteAsaasPaymentDocumentResponse } from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class DeletePaymentDocumentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  deletePaymentDocument = async (
    paymentId: string,
    documentId: string
  ): Promise<IDeleteAsaasPaymentDocumentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .delete<IDeleteAsaasPaymentDocumentResponse>(
          `/v3/payments/${paymentId}/documents/${documentId}`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao excluir documento da cobrança no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao excluir documento da cobrança no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
