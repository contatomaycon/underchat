import { inject, injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasInstallmentsRequest,
  IListAsaasInstallmentsResponse,
} from '@core/common/interfaces/IAsaasInstallment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class ListInstallmentsService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao listar parcelamentos');
      }

      throw new Error('Erro desconhecido ao listar parcelamentos');
    }
  };
}
