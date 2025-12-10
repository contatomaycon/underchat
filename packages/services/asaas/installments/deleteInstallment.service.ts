import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IDeleteAsaasInstallmentResponse } from '@core/common/interfaces/IAsaasInstallment';

@injectable()
export class DeleteInstallmentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  deleteInstallment = async (
    installmentId: string
  ): Promise<IDeleteAsaasInstallmentResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .delete<IDeleteAsaasInstallmentResponse>(
          `/v3/installments/${installmentId}`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao remover parcelamento no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao remover parcelamento no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
