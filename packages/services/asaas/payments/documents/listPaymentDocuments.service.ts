import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../../asaasBase.service';
import { IListAsaasPaymentDocumentsResponse } from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class ListPaymentDocumentsService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  listPaymentDocuments = async (
    paymentId: string
  ): Promise<IListAsaasPaymentDocumentsResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasPaymentDocumentsResponse>(
          `/v3/payments/${paymentId}/documents`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao listar documentos da cobrança no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao listar documentos da cobrança no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
