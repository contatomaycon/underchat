import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasInvoicesRequest,
  IListAsaasInvoicesResponse,
} from '@core/common/interfaces/IAsaasInvoice';

@injectable()
export class ListInvoicesService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  listInvoices = async (
    request?: IListAsaasInvoicesRequest
  ): Promise<IListAsaasInvoicesResponse | null> => {
    try {
      const params = new URLSearchParams();

      if (request?.offset !== undefined) {
        params.append('offset', request.offset.toString());
      }

      if (request?.limit !== undefined) {
        params.append('limit', request.limit.toString());
      }

      if (request?.['effectiveDate[ge]']) {
        params.append('effectiveDate[ge]', request['effectiveDate[ge]']);
      }

      if (request?.['effectiveDate[le]']) {
        params.append('effectiveDate[le]', request['effectiveDate[le]']);
      }

      if (request?.payment) {
        params.append('payment', request.payment);
      }

      if (request?.installment) {
        params.append('installment', request.installment);
      }

      if (request?.externalReference) {
        params.append('externalReference', request.externalReference);
      }

      if (request?.status) {
        params.append('status', request.status);
      }

      if (request?.customer) {
        params.append('customer', request.customer);
      }

      const queryString = params.toString();
      const url = queryString ? `/v3/invoices?${queryString}` : '/v3/invoices';

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasInvoicesResponse>(url);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao listar notas fiscais no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao listar notas fiscais no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
