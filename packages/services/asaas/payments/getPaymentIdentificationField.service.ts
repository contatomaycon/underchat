import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IGetAsaasPaymentIdentificationFieldResponse } from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class GetPaymentIdentificationFieldService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getPaymentIdentificationField = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentIdentificationFieldResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IGetAsaasPaymentIdentificationFieldResponse>(
          `/v3/payments/${paymentId}/identificationField`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao obter linha digitável do boleto no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao obter linha digitável do boleto no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
