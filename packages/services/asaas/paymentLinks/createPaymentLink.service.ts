import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasPaymentLinkRequest,
  ICreateAsaasPaymentLinkResponse,
} from '@core/common/interfaces/IAsaasPaymentLink';

@injectable()
export class CreatePaymentLinkService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  createPaymentLink = async (
    request: ICreateAsaasPaymentLinkRequest
  ): Promise<ICreateAsaasPaymentLinkResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasPaymentLinkResponse>('/v3/paymentLinks', request);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao criar link de pagamentos no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao criar link de pagamentos no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
