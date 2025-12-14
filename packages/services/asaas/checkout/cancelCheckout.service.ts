import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { ICreateAsaasCheckoutResponse } from '@core/common/interfaces/IAsaasCheckout';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class CancelCheckoutService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  cancelCheckout = async (
    checkoutId: string
  ): Promise<ICreateAsaasCheckoutResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasCheckoutResponse>(
          `/v3/checkouts/${checkoutId}/cancel`,
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

        throw new Error('Erro ao cancelar checkout');
      }

      throw new Error('Erro desconhecido ao cancelar checkout');
    }
  };
}
