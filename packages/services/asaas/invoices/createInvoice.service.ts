import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasInvoiceRequest,
  ICreateAsaasInvoiceResponse,
} from '@core/common/interfaces/IAsaasInvoice';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class CreateInvoiceService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

  createInvoice = async (
    request: ICreateAsaasInvoiceRequest
  ): Promise<ICreateAsaasInvoiceResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasInvoiceResponse>('/v3/invoices', request);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const descriptions = errorData.errors
            .map((item) => item.description?.trim())
            .filter(
              (description): description is string => !!description?.length
            );

          if (descriptions.length > 0) {
            throw new Error(descriptions.join('; '));
          }
        }

        throw new Error('Erro ao agendar nota fiscal');
      }

      throw new Error('Erro desconhecido ao agendar nota fiscal');
    }
  };
}
