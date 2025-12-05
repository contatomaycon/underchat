import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IPayAsaasPaymentWithCreditCardRequest,
  IPayAsaasPaymentWithCreditCardResponse,
} from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class PayWithCreditCardService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  payWithCreditCard = async (
    paymentId: string,
    request: IPayAsaasPaymentWithCreditCardRequest
  ): Promise<IPayAsaasPaymentWithCreditCardResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<IPayAsaasPaymentWithCreditCardResponse>(
          `/v3/payments/${paymentId}/payWithCreditCard`,
          request
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao pagar cobrança com cartão de crédito no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao pagar cobrança com cartão de crédito no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
