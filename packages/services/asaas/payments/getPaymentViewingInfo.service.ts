import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IGetAsaasPaymentViewingInfoResponse } from '@core/common/interfaces/IAsaasPayment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error(
          'Erro ao recuperar informações de visualização da cobrança'
        );
      }

      throw new Error(
        'Erro desconhecido ao recuperar informações de visualização da cobrança'
      );
    }
  };
}
