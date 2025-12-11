import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IUpdateAsaasInstallmentSplitsRequest,
  IUpdateAsaasInstallmentSplitsResponse,
} from '@core/common/interfaces/IAsaasInstallment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class UpdateInstallmentSplitsService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  updateInstallmentSplits = async (
    installmentId: string,
    request: IUpdateAsaasInstallmentSplitsRequest
  ): Promise<IUpdateAsaasInstallmentSplitsResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .put<IUpdateAsaasInstallmentSplitsResponse>(
          `/v3/installments/${installmentId}/splits`,
          request
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

        throw new Error('Erro ao atualizar splits de parcelamento');
      }

      throw new Error('Erro desconhecido ao atualizar splits de parcelamento');
    }
  };
}
