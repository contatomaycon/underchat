import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasCreditCardPaymentRequest,
  ICreateAsaasCreditCardPaymentResponse,
} from '@core/common/interfaces/IAsaasPayment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class CreateCreditCardPaymentService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao criar cobrança com cartão de crédito');
      }

      throw new Error(
        'Erro desconhecido ao criar cobrança com cartão de crédito'
      );
    }
  };
}
