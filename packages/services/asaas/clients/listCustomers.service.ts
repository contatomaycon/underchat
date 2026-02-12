import { inject, injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasCustomersRequest,
  IListAsaasCustomersResponse,
} from '@core/common/interfaces/IAsaasCustomer';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class ListCustomersService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

  listCustomers = async (
    request?: IListAsaasCustomersRequest
  ): Promise<IListAsaasCustomersResponse | null> => {
    try {
      const queryString = this.buildQueryString(request);
      const url = queryString
        ? `/v3/customers?${queryString}`
        : '/v3/customers';

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasCustomersResponse>(url);

      if (response.status !== 200 || !response.data) {
        return null;
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;
          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao listar clientes');
      }

      throw new Error('Erro desconhecido ao listar clientes');
    }
  };

  private readonly buildQueryString = (
    request?: IListAsaasCustomersRequest
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
      ['name', request.name],
      ['email', request.email],
      ['cpfCnpj', request.cpfCnpj],
      ['groupName', request.groupName],
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
