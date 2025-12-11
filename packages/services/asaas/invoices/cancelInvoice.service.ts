import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICancelAsaasInvoiceRequest,
  ICancelAsaasInvoiceResponse,
} from '@core/common/interfaces/IAsaasInvoice';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class CancelInvoiceService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  cancelInvoice = async (
    invoiceId: string,
    request?: ICancelAsaasInvoiceRequest
  ): Promise<ICancelAsaasInvoiceResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICancelAsaasInvoiceResponse>(
          `/v3/invoices/${invoiceId}/cancel`,
          request || {}
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

        throw new Error('Erro ao cancelar nota fiscal');
      }

      throw new Error('Erro desconhecido ao cancelar nota fiscal');
    }
  };
}
