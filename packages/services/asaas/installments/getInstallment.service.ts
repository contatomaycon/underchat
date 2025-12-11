import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { ICreateAsaasInstallmentResponse } from '@core/common/interfaces/IAsaasInstallment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class GetInstallmentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getInstallment = async (
    installmentId: string
  ): Promise<ICreateAsaasInstallmentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<ICreateAsaasInstallmentResponse>(
          `/v3/installments/${installmentId}`
        );

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

        throw new Error('Erro ao recuperar parcelamento');
      }

      throw new Error('Erro desconhecido ao recuperar parcelamento');
    }
  };
}
