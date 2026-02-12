import { inject, injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasInstallmentWithCreditCardRequest,
  ICreateAsaasInstallmentWithCreditCardResponse,
} from '@core/common/interfaces/IAsaasInstallment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class CreateInstallmentWithCreditCardService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao criar parcelamento com cartão de crédito');
      }

      throw new Error(
        'Erro desconhecido ao criar parcelamento com cartão de crédito'
      );
    }
  };
}
