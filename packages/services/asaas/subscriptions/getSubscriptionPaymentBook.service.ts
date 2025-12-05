import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IGetAsaasSubscriptionPaymentBookRequest } from '@core/common/interfaces/IAsaasSubscription';

@injectable()
export class GetSubscriptionPaymentBookService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getSubscriptionPaymentBook = async (
    subscriptionId: string,
    request?: IGetAsaasSubscriptionPaymentBookRequest
  ): Promise<ArrayBuffer | null> => {
    try {
      const params = new URLSearchParams();

      if (request?.month !== undefined) {
        params.append('month', request.month.toString());
      }

      if (request?.year !== undefined) {
        params.append('year', request.year.toString());
      }

      if (request?.sort) {
        params.append('sort', request.sort);
      }

      if (request?.order) {
        params.append('order', request.order);
      }

      const queryString = params.toString();
      const url = queryString
        ? `/v3/subscriptions/${subscriptionId}/paymentBook?${queryString}`
        : `/v3/subscriptions/${subscriptionId}/paymentBook`;

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<ArrayBuffer>(url, {
          responseType: 'arraybuffer',
          headers: {
            Accept: 'application/pdf',
          },
        });

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao gerar carnê da assinatura no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao gerar carnê da assinatura no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
