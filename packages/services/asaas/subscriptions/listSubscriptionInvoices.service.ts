import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasSubscriptionInvoicesRequest,
  IListAsaasSubscriptionInvoicesResponse,
} from '@core/common/interfaces/IAsaasSubscription';

@injectable()
export class ListSubscriptionInvoicesService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  listSubscriptionInvoices = async (
    subscriptionId: string,
    request?: IListAsaasSubscriptionInvoicesRequest
  ): Promise<IListAsaasSubscriptionInvoicesResponse | null> => {
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
      const url = queryString
        ? `/v3/subscriptions/${subscriptionId}/invoices?${queryString}`
        : `/v3/subscriptions/${subscriptionId}/invoices`;

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasSubscriptionInvoicesResponse>(url);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao listar notas fiscais da assinatura no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao listar notas fiscais da assinatura no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
