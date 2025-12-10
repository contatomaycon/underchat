import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasInstallmentsRequest,
  IListAsaasInstallmentsResponse,
} from '@core/common/interfaces/IAsaasInstallment';

@injectable()
export class ListInstallmentsService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  listInstallments = async (
    request?: IListAsaasInstallmentsRequest
  ): Promise<IListAsaasInstallmentsResponse | null> => {
    try {
      const params = new URLSearchParams();

      if (request?.offset !== undefined) {
        params.append('offset', request.offset.toString());
      }

      if (request?.limit !== undefined) {
        params.append('limit', request.limit.toString());
      }

      const queryString = params.toString();
      const url = queryString
        ? `/v3/installments?${queryString}`
        : '/v3/installments';

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasInstallmentsResponse>(url);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao listar parcelamentos no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao listar parcelamentos no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
