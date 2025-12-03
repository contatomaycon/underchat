import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IUpdateAsaasCustomerRequest,
  IUpdateAsaasCustomerResponse,
} from '@core/common/interfaces/IAsaasCustomer';

@injectable()
export class UpdateCustomerService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  updateCustomer = async (
    customerId: string,
    request: IUpdateAsaasCustomerRequest
  ): Promise<IUpdateAsaasCustomerResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .put<IUpdateAsaasCustomerResponse>(
          `/v3/customers/${customerId}`,
          request
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao atualizar cliente no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao atualizar cliente no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
