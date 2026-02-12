import { inject, injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IGetAsaasInstallmentPaymentBookRequest } from '@core/common/interfaces/IAsaasInstallment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class GetInstallmentPaymentBookService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao gerar carnê de parcelamento');
      }

      throw new Error('Erro desconhecido ao gerar carnê de parcelamento');
    }
  };
}
