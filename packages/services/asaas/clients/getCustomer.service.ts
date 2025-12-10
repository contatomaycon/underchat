import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IGetAsaasCustomerResponse } from '@core/common/interfaces/IAsaasCustomer';

@injectable()
export class GetCustomerService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getCustomer = async (
    customerId: string
  ): Promise<IGetAsaasCustomerResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IGetAsaasCustomerResponse>(`/v3/customers/${customerId}`);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao recuperar cliente no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao recuperar cliente no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
