import { inject, injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasInstallmentRequest,
  ICreateAsaasInstallmentResponse,
} from '@core/common/interfaces/IAsaasInstallment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class CreateInstallmentService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

  createInstallment = async (
    request: ICreateAsaasInstallmentRequest
  ): Promise<ICreateAsaasInstallmentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .post<ICreateAsaasInstallmentResponse>('/v3/installments', request);

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

        throw new Error('Erro ao criar parcelamento');
      }

      throw new Error('Erro desconhecido ao criar parcelamento');
    }
  };
}
