import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasInvoiceRequest,
  ICreateAsaasInvoiceResponse,
} from '@core/common/interfaces/IAsaasInvoice';

@injectable()
export class CreateInvoiceService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  createInvoice = async (
    request: ICreateAsaasInvoiceRequest
  ): Promise<ICreateAsaasInvoiceResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasInvoiceResponse>('/v3/invoices', request);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao agendar nota fiscal no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao agendar nota fiscal no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
