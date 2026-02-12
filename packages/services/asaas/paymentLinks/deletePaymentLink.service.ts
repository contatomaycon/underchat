import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IDeleteAsaasPaymentLinkResponse } from '@core/common/interfaces/IAsaasPaymentLink';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class DeletePaymentLinkService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

  deletePaymentLink = async (
    paymentLinkId: string
  ): Promise<IDeleteAsaasPaymentLinkResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .delete<IDeleteAsaasPaymentLinkResponse>(
          `/v3/paymentLinks/${paymentLinkId}`
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

        throw new Error('Erro ao remover link de pagamentos');
      }

      throw new Error('Erro desconhecido ao remover link de pagamentos');
    }
  };
}
