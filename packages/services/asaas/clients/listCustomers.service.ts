import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasCustomersRequest,
  IListAsaasCustomersResponse,
} from '@core/common/interfaces/IAsaasCustomer';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class ListCustomersService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  listCustomers = async (
    request?: IListAsaasCustomersRequest
  ): Promise<IListAsaasCustomersResponse | null> => {
    try {
      const params = new URLSearchParams();

      if (request?.offset !== undefined) {
        params.append('offset', request.offset.toString());
      }

      if (request?.limit !== undefined) {
        params.append('limit', request.limit.toString());
      }

      if (request?.name) {
        params.append('name', request.name);
      }

      if (request?.email) {
        params.append('email', request.email);
      }

      if (request?.cpfCnpj) {
        params.append('cpfCnpj', request.cpfCnpj);
      }

      if (request?.groupName) {
        params.append('groupName', request.groupName);
      }

      if (request?.externalReference) {
        params.append('externalReference', request.externalReference);
      }

      const queryString = params.toString();
      const url = queryString
        ? `/v3/customers?${queryString}`
        : '/v3/customers';

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasCustomersResponse>(url);

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

        throw new Error('Erro ao listar clientes');
      }

      throw new Error('Erro desconhecido ao listar clientes');
    }
  };
}
