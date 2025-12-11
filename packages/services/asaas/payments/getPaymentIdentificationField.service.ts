import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IGetAsaasPaymentIdentificationFieldResponse } from '@core/common/interfaces/IAsaasPayment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao obter linha digitável do boleto');
      }

      throw new Error('Erro desconhecido ao obter linha digitável do boleto');
    }
  };
}
