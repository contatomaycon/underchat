import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IGetAsaasInstallmentPaymentBookRequest } from '@core/common/interfaces/IAsaasInstallment';

@injectable()
export class GetInstallmentPaymentBookService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getInstallmentPaymentBook = async (
    installmentId: string,
    request?: IGetAsaasInstallmentPaymentBookRequest
  ): Promise<ArrayBuffer | null> => {
    try {
      const params = new URLSearchParams();

      if (request?.sort) {
        params.append('sort', request.sort);
      }

      if (request?.order) {
        params.append('order', request.order);
      }

      const queryString = params.toString();
      const url = queryString
        ? `/v3/installments/${installmentId}/paymentBook?${queryString}`
        : `/v3/installments/${installmentId}/paymentBook`;

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<ArrayBuffer>(url, {
          responseType: 'arraybuffer',
          headers: {
            Accept: 'application/pdf',
          },
        });

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao gerar carnê do parcelamento no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao gerar carnê do parcelamento no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
