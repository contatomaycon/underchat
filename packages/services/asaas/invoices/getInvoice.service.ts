import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IGetAsaasInvoiceResponse } from '@core/common/interfaces/IAsaasInvoice';

@injectable()
export class GetInvoiceService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getInvoice = async (
    invoiceId: string
  ): Promise<IGetAsaasInvoiceResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IGetAsaasInvoiceResponse>(`/v3/invoices/${invoiceId}`);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao recuperar nota fiscal no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao recuperar nota fiscal no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
