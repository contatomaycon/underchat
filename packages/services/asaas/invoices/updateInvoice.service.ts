import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IUpdateAsaasInvoiceRequest,
  IUpdateAsaasInvoiceResponse,
} from '@core/common/interfaces/IAsaasInvoice';

@injectable()
export class UpdateInvoiceService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  updateInvoice = async (
    invoiceId: string,
    request: IUpdateAsaasInvoiceRequest
  ): Promise<IUpdateAsaasInvoiceResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .put<IUpdateAsaasInvoiceResponse>(`/v3/invoices/${invoiceId}`, request);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao atualizar nota fiscal no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao atualizar nota fiscal no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
