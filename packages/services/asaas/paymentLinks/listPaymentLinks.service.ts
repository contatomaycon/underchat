import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasPaymentLinksRequest,
  IListAsaasPaymentLinksResponse,
} from '@core/common/interfaces/IAsaasPaymentLink';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class ListPaymentLinksService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  listPaymentLinks = async (
    request?: IListAsaasPaymentLinksRequest
  ): Promise<IListAsaasPaymentLinksResponse | null> => {
    try {
      const params = new URLSearchParams();

      if (request?.offset !== undefined) {
        params.append('offset', request.offset.toString());
      }

      if (request?.limit !== undefined) {
        params.append('limit', request.limit.toString());
      }

      if (request?.active !== undefined) {
        params.append('active', request.active.toString());
      }

      if (request?.includeDeleted !== undefined) {
        params.append('includeDeleted', request.includeDeleted.toString());
      }

      if (request?.name) {
        params.append('name', request.name);
      }

      if (request?.externalReference) {
        params.append('externalReference', request.externalReference);
      }

      const queryString = params.toString();
      const url = queryString
        ? `/v3/paymentLinks?${queryString}`
        : '/v3/paymentLinks';

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasPaymentLinksResponse>(url);

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

        throw new Error('Erro ao listar links de pagamentos');
      }

      throw new Error('Erro desconhecido ao listar links de pagamentos');
    }
  };
}
