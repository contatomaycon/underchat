import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IRefundAsaasInstallmentRequest,
  IRefundAsaasInstallmentResponse,
} from '@core/common/interfaces/IAsaasInstallment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao estornar parcelamento');
      }

      throw new Error('Erro desconhecido ao estornar parcelamento');
    }
  };
}
