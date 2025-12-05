import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IGetAsaasPaymentViewingInfoResponse } from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class GetPaymentViewingInfoService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getPaymentViewingInfo = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentViewingInfoResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IGetAsaasPaymentViewingInfoResponse>(
          `/v3/payments/${paymentId}/viewingInfo`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao recuperar informações de visualização da cobrança no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao recuperar informações de visualização da cobrança no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
