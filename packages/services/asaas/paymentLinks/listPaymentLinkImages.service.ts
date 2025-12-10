import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IListAsaasPaymentLinkImagesResponse } from '@core/common/interfaces/IAsaasPaymentLink';

@injectable()
export class ListPaymentLinkImagesService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

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
        console.error(
          'Erro ao listar imagens do link de pagamentos no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao listar imagens do link de pagamentos no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
