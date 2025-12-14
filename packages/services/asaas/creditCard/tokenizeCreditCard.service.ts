import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ITokenizeAsaasCreditCardRequest,
  ITokenizeAsaasCreditCardResponse,
  IAsaasErrorResponse,
} from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class TokenizeCreditCardService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

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

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao tokenizar cartão de crédito');
      }

      throw new Error('Erro desconhecido ao tokenizar cartão de crédito');
    }
  };
}
