import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IUpdateAsaasInstallmentSplitsRequest,
  IUpdateAsaasInstallmentSplitsResponse,
} from '@core/common/interfaces/IAsaasInstallment';

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
        console.error(
          'Erro ao atualizar splits do parcelamento no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao atualizar splits do parcelamento no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
