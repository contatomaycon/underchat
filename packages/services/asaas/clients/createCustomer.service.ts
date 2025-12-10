import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasCustomerRequest,
  ICreateAsaasCustomerResponse,
} from '@core/common/interfaces/IAsaasCustomer';

@injectable()
export class CreateCustomerService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  createCustomer = async (
    request: ICreateAsaasCustomerRequest
  ): Promise<ICreateAsaasCustomerResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasCustomerResponse>('/v3/customers', request);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Erro ao criar cliente no Asaas:', error.response?.data);
      } else {
        console.error('Erro desconhecido ao criar cliente no Asaas:', error);
      }
      return null;
    }
  };
}
