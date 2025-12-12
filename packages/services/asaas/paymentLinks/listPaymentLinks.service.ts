import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasPaymentLinksRequest,
  IListAsaasPaymentLinksResponse,
} from '@core/common/interfaces/IAsaasPaymentLink';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class ListPaymentLinksService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  listPaymentLinks = async (
    request?: IListAsaasPaymentLinksRequest
  ): Promise<IListAsaasPaymentLinksResponse | null> => {
    try {
      const queryString = this.buildQueryString(request);
      const url = queryString
        ? `/v3/paymentLinks?${queryString}`
        : '/v3/paymentLinks';

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasPaymentLinksResponse>(url);

      if (response.status !== 200 || !response.data) {
        return null;
      }

      return response.data;
    } catch (error) {
      if (!axios.isAxiosError(error)) {
        throw new Error('Erro desconhecido ao listar links de pagamentos');
      }

      const errorData = error.response?.data as IAsaasErrorResponse;

      if (errorData?.errors && errorData.errors.length > 0) {
        const firstErrorDescription = errorData.errors[0].description;
        throw new Error(firstErrorDescription);
      }

      throw new Error('Erro ao listar links de pagamentos');
    }
  };

  private readonly buildQueryString = (
    request?: IListAsaasPaymentLinksRequest
  ): string => {
    const params = new URLSearchParams();
    if (!request) {
      return '';
    }

    const toStringIfDefined = (
      value?: string | number | boolean
    ): string | undefined => {
      if (value === undefined) {
        return undefined;
      }

      return value.toString();
    };

    const entries: Array<[string, string | undefined]> = [
      ['offset', toStringIfDefined(request.offset)],
      ['limit', toStringIfDefined(request.limit)],
      ['active', toStringIfDefined(request.active)],
      ['includeDeleted', toStringIfDefined(request.includeDeleted)],
      ['name', request.name],
      ['externalReference', request.externalReference],
    ];

    for (const [key, value] of entries) {
      if (value) {
        params.append(key, value);
      }
    }

    return params.toString();
  };
}
