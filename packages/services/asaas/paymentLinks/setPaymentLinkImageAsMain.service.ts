import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { ISetAsMainPaymentLinkImageResponse } from '@core/common/interfaces/IAsaasPaymentLink';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class SetPaymentLinkImageAsMainService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

  setPaymentLinkImageAsMain = async (
    paymentLinkId: string,
    imageId: string
  ): Promise<ISetAsMainPaymentLinkImageResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .put<ISetAsMainPaymentLinkImageResponse>(
          `/v3/paymentLinks/${paymentLinkId}/images/${imageId}/setAsMain`,
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

        throw new Error(
          'Erro ao definir imagem principal do link de pagamentos'
        );
      }

      throw new Error(
        'Erro desconhecido ao definir imagem principal do link de pagamentos'
      );
    }
  };
}
