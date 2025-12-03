import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IDeleteAsaasCustomerResponse } from '@core/common/interfaces/IAsaasCustomer';

@injectable()
export class DeleteCustomerService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  deleteCustomer = async (
    customerId: string
  ): Promise<IDeleteAsaasCustomerResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .delete<IDeleteAsaasCustomerResponse>(`/v3/customers/${customerId}`);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao remover cliente no Asaas:',
          error.response?.data
        );
      } else {
        console.error('Erro desconhecido ao remover cliente no Asaas:', error);
      }
      return null;
    }
  };
}
