import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasSubscriptionsRequest,
  IListAsaasSubscriptionsResponse,
} from '@core/common/interfaces/IAsaasSubscription';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class ListSubscriptionsService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao listar assinaturas');
      }

      throw new Error('Erro desconhecido ao listar assinaturas');
    }
  };
}
