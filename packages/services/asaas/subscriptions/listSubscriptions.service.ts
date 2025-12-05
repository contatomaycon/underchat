import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasSubscriptionsRequest,
  IListAsaasSubscriptionsResponse,
} from '@core/common/interfaces/IAsaasSubscription';

@injectable()
export class ListSubscriptionsService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  private buildQueryParams(
    request?: IListAsaasSubscriptionsRequest
  ): URLSearchParams {
    const params = new URLSearchParams();

    if (request?.offset !== undefined) {
      params.append('offset', request.offset.toString());
    }

    if (request?.limit !== undefined) {
      params.append('limit', request.limit.toString());
    }

    if (request?.customer) {
      params.append('customer', request.customer);
    }

    if (request?.customerGroupName) {
      params.append('customerGroupName', request.customerGroupName);
    }

    if (request?.billingType) {
      params.append('billingType', request.billingType);
    }

    if (request?.status) {
      params.append('status', request.status);
    }

    if (request?.deletedOnly !== undefined) {
      params.append('deletedOnly', request.deletedOnly.toString());
    }

    if (request?.includeDeleted !== undefined) {
      params.append('includeDeleted', request.includeDeleted.toString());
    }

    if (request?.externalReference) {
      params.append('externalReference', request.externalReference);
    }

    if (request?.order) {
      params.append('order', request.order);
    }

    if (request?.sort) {
      params.append('sort', request.sort);
    }

    return params;
  }

  listSubscriptions = async (
    request?: IListAsaasSubscriptionsRequest
  ): Promise<IListAsaasSubscriptionsResponse | null> => {
    try {
      const params = this.buildQueryParams(request);
      const queryString = params.toString();
      const url = queryString
        ? `/v3/subscriptions?${queryString}`
        : '/v3/subscriptions';

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasSubscriptionsResponse>(url);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao listar assinaturas no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao listar assinaturas no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
