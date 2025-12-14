import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../../asaasBase.service';
import { IDeleteAsaasPaymentDocumentResponse } from '@core/common/interfaces/IAsaasPayment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao excluir documento da cobrança');
      }

      throw new Error('Erro desconhecido ao excluir documento da cobrança');
    }
  };
}
