import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IRefundAsaasInstallmentRequest,
  IRefundAsaasInstallmentResponse,
} from '@core/common/interfaces/IAsaasInstallment';

@injectable()
export class RefundInstallmentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  refundInstallment = async (
    installmentId: string,
    request?: IRefundAsaasInstallmentRequest
  ): Promise<IRefundAsaasInstallmentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<IRefundAsaasInstallmentResponse>(
          `/v3/installments/${installmentId}/refund`,
          request || {}
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao estornar parcelamento no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao estornar parcelamento no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
