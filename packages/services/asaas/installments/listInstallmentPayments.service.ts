import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasInstallmentPaymentsRequest,
  IListAsaasInstallmentPaymentsResponse,
} from '@core/common/interfaces/IAsaasInstallment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class ListInstallmentPaymentsService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  listInstallmentPayments = async (
    installmentId: string,
    request?: IListAsaasInstallmentPaymentsRequest
  ): Promise<IListAsaasInstallmentPaymentsResponse | null> => {
    try {
      const params = new URLSearchParams();

      if (request?.status) {
        params.append('status', request.status);
      }

      const queryString = params.toString();
      const url = queryString
        ? `/v3/installments/${installmentId}/payments?${queryString}`
        : `/v3/installments/${installmentId}/payments`;

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasInstallmentPaymentsResponse>(url);

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

        throw new Error('Erro ao listar cobranças de parcelamento');
      }

      throw new Error('Erro desconhecido ao listar cobranças de parcelamento');
    }
  };
}
