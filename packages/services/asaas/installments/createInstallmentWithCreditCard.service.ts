import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasInstallmentWithCreditCardRequest,
  ICreateAsaasInstallmentWithCreditCardResponse,
} from '@core/common/interfaces/IAsaasInstallment';

@injectable()
export class CreateInstallmentWithCreditCardService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  createInstallmentWithCreditCard = async (
    request: ICreateAsaasInstallmentWithCreditCardRequest
  ): Promise<ICreateAsaasInstallmentWithCreditCardResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasInstallmentWithCreditCardResponse>(
          '/v3/installments/',
          request
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao criar parcelamento com cartão de crédito no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao criar parcelamento com cartão de crédito no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
