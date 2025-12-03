import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IRestoreAsaasCustomerResponse } from '@core/common/interfaces/IAsaasCustomer';

@injectable()
export class RestoreCustomerService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  restoreCustomer = async (
    customerId: string
  ): Promise<IRestoreAsaasCustomerResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<IRestoreAsaasCustomerResponse>(
          `/v3/customers/${customerId}/restore`,
          {}
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao restaurar cliente no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao restaurar cliente no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
