import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasInvoicesRequest,
  IListAsaasInvoicesResponse,
} from '@core/common/interfaces/IAsaasInvoice';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class ListInvoicesService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

  private buildQueryParams(
    request?: IListAsaasInvoicesRequest
  ): URLSearchParams {
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

    return params;
  }

  listInvoices = async (
    request?: IListAsaasInvoicesRequest
  ): Promise<IListAsaasInvoicesResponse | null> => {
    try {
      const params = this.buildQueryParams(request);
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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao listar notas fiscais');
      }

      throw new Error('Erro desconhecido ao listar notas fiscais');
    }
  };
}
