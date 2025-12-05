import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasCreditCardPaymentRequest,
  ICreateAsaasCreditCardPaymentResponse,
} from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class CreateCreditCardPaymentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  createCreditCardPayment = async (
    request: ICreateAsaasCreditCardPaymentRequest
  ): Promise<ICreateAsaasCreditCardPaymentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasCreditCardPaymentResponse>('/v3/payments', request);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao criar cobrança com cartão de crédito no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao criar cobrança com cartão de crédito no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
