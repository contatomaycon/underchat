import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasInstallmentPaymentsRequest,
  IListAsaasInstallmentPaymentsResponse,
} from '@core/common/interfaces/IAsaasInstallment';

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
        console.error(
          'Erro ao listar cobranças do parcelamento no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao listar cobranças do parcelamento no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
