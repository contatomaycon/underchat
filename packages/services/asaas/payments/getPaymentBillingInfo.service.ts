import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IGetAsaasPaymentBillingInfoResponse } from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class GetPaymentBillingInfoService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getPaymentBillingInfo = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentBillingInfoResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IGetAsaasPaymentBillingInfoResponse>(
          `/v3/payments/${paymentId}/billingInfo`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao recuperar informações de pagamento no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao recuperar informações de pagamento no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
