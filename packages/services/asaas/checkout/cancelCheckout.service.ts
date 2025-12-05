import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { ICreateAsaasCheckoutResponse } from '@core/common/interfaces/IAsaasCheckout';

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
        console.error(
          'Erro ao cancelar checkout no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao cancelar checkout no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
