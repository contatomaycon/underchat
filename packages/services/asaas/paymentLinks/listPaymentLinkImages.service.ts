import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IListAsaasPaymentLinkImagesResponse } from '@core/common/interfaces/IAsaasPaymentLink';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class ListPaymentLinkImagesService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

  listPaymentLinkImages = async (
    paymentLinkId: string
  ): Promise<IListAsaasPaymentLinkImagesResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasPaymentLinkImagesResponse>(
          `/v3/paymentLinks/${paymentLinkId}/images`
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

        throw new Error('Erro ao listar imagens do link de pagamentos');
      }

      throw new Error(
        'Erro desconhecido ao listar imagens do link de pagamentos'
      );
    }
  };
}
