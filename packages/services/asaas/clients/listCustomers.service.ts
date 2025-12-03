import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasCustomersRequest,
  IListAsaasCustomersResponse,
} from '@core/common/interfaces/IAsaasCustomer';

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
        console.error(
          'Erro ao listar clientes no Asaas:',
          error.response?.data
        );
      } else {
        console.error('Erro desconhecido ao listar clientes no Asaas:', error);
      }
      return null;
    }
  };
}
