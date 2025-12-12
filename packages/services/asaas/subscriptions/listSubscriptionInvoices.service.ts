import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasSubscriptionInvoicesRequest,
  IListAsaasSubscriptionInvoicesResponse,
} from '@core/common/interfaces/IAsaasSubscription';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class ListSubscriptionInvoicesService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  listSubscriptionInvoices = async (
    subscriptionId: string,
    request?: IListAsaasSubscriptionInvoicesRequest
  ): Promise<IListAsaasSubscriptionInvoicesResponse | null> => {
    try {
      const queryString = this.buildQueryString(request);
      const baseUrl = `/v3/subscriptions/${subscriptionId}/invoices`;
      const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasSubscriptionInvoicesResponse>(url);

      if (response.status !== 200 || !response.data) {
        return null;
      }

      return response.data;
    } catch (error) {
      if (!axios.isAxiosError(error)) {
        throw new Error(
          'Erro desconhecido ao listar notas fiscais da assinatura'
        );
      }

      const errorData = error.response?.data as IAsaasErrorResponse;

      if (errorData?.errors && errorData.errors.length > 0) {
        const firstErrorDescription = errorData.errors[0].description;
        throw new Error(firstErrorDescription);
      }

      throw new Error('Erro ao listar notas fiscais da assinatura');
    }
  };

  private readonly buildQueryString = (
    request?: IListAsaasSubscriptionInvoicesRequest
  ): string => {
    const params = new URLSearchParams();
    if (!request) {
      return '';
    }

    const entries: Array<[string, string | undefined]> = [
      [
        'offset',
        request.offset !== undefined ? request.offset.toString() : undefined,
      ],
      [
        'limit',
        request.limit !== undefined ? request.limit.toString() : undefined,
      ],
      ['effectiveDate[ge]', request['effectiveDate[ge]']],
      ['effectiveDate[le]', request['effectiveDate[le]']],
      ['externalReference', request.externalReference],
      ['status', request.status],
      ['customer', request.customer],
    ];

    for (const [key, value] of entries) {
      if (value) {
        params.append(key, value);
      }
    }

    return params.toString();
  };
}
