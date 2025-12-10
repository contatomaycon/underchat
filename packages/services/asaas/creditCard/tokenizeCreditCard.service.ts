import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ITokenizeAsaasCreditCardRequest,
  ITokenizeAsaasCreditCardResponse,
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
        console.error(
          'Erro ao tokenizar cartão de crédito no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao tokenizar cartão de crédito no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
