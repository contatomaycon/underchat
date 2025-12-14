import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IRefundAsaasBankSlipResponse } from '@core/common/interfaces/IAsaasRefund';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class RefundBankSlipService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  refundBankSlip = async (
    paymentId: string
  ): Promise<IRefundAsaasBankSlipResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<IRefundAsaasBankSlipResponse>(
          `/v3/payments/${paymentId}/bankSlip/refund`,
          {}
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

        throw new Error('Erro ao estornar boleto');
      }

      throw new Error('Erro desconhecido ao estornar boleto');
    }
  };
}
