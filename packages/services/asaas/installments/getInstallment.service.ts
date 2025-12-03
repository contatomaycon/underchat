import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { ICreateAsaasInstallmentResponse } from '@core/common/interfaces/IAsaasInstallment';

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
        console.error(
          'Erro ao recuperar parcelamento no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao recuperar parcelamento no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
