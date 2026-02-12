import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IRestoreAsaasPaymentLinkResponse } from '@core/common/interfaces/IAsaasPaymentLink';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class RestorePaymentLinkService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

  restorePaymentLink = async (
    paymentLinkId: string
  ): Promise<IRestoreAsaasPaymentLinkResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<IRestoreAsaasPaymentLinkResponse>(
          `/v3/paymentLinks/${paymentLinkId}/restore`,
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

        throw new Error('Erro ao restaurar link de pagamentos');
      }

      throw new Error('Erro desconhecido ao restaurar link de pagamentos');
    }
  };
}
