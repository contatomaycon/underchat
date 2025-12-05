import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasPaymentRequest,
  ICreateAsaasPaymentResponse,
} from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class CreatePaymentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  createPayment = async (
    request: ICreateAsaasPaymentRequest
  ): Promise<ICreateAsaasPaymentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasPaymentResponse>('/v3/payments', request);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Erro ao criar cobrança no Asaas:', error.response?.data);
      } else {
        console.error('Erro desconhecido ao criar cobrança no Asaas:', error);
      }
      return null;
    }
  };
}
