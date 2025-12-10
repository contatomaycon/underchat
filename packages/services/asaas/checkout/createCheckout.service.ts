import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasCheckoutRequest,
  ICreateAsaasCheckoutResponse,
} from '@core/common/interfaces/IAsaasCheckout';

@injectable()
export class CreateCheckoutService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  createCheckout = async (
    request: ICreateAsaasCheckoutRequest
  ): Promise<ICreateAsaasCheckoutResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasCheckoutResponse>('/v3/checkouts', request);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Erro ao criar checkout no Asaas:', error.response?.data);
      } else {
        console.error('Erro desconhecido ao criar checkout no Asaas:', error);
      }
      return null;
    }
  };
}
