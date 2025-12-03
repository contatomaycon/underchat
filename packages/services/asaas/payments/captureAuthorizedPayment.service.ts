import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { ICreateAsaasPaymentResponse } from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class CaptureAuthorizedPaymentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  captureAuthorizedPayment = async (
    paymentId: string
  ): Promise<ICreateAsaasPaymentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasPaymentResponse>(
          `/v3/payments/${paymentId}/captureAuthorizedPayment`,
          {}
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao capturar cobrança pré-autorizada no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao capturar cobrança pré-autorizada no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
