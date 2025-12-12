import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IGetAsaasCustomerResponse } from '@core/common/interfaces/IAsaasCustomer';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao buscar cliente');
      }

      throw new Error('Erro desconhecido ao buscar cliente');
    }
  };
}
