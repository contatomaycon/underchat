import { inject, injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ITokenizeAsaasCreditCardRequest,
  ITokenizeAsaasCreditCardResponse,
  IAsaasErrorResponse,
} from '@core/common/interfaces/IAsaasCreditCard';
import { CreditCardAlreadyTokenizedError } from '@core/common/exceptions/UserCardError';

@injectable()
export class TokenizeCreditCardService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

  private readonly isAlreadyTokenizedDescription = (
    description: string
  ): boolean => {
    const normalizedDescription = description
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();

    return /\b(?:ja\s+(?:esta\s+)?tokenizado|already\s+(?:(?:is|been)\s+)?tokenized)\b/.test(
      normalizedDescription
    );
  };

  tokenizeCreditCard = async (
    request: ITokenizeAsaasCreditCardRequest
  ): Promise<ITokenizeAsaasCreditCardResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ITokenizeAsaasCreditCardResponse>(
          '/v3/creditCard/tokenizeCreditCard',
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

          if (
            firstErrorDescription &&
            this.isAlreadyTokenizedDescription(firstErrorDescription)
          ) {
            throw new CreditCardAlreadyTokenizedError();
          }

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao tokenizar cartão de crédito');
      }

      throw new Error('Erro desconhecido ao tokenizar cartão de crédito');
    }
  };
}
