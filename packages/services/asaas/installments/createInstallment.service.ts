import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  ICreateAsaasInstallmentRequest,
  ICreateAsaasInstallmentResponse,
} from '@core/common/interfaces/IAsaasInstallment';

@injectable()
export class CreateInstallmentService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

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
        console.error(
          'Erro ao criar parcelamento no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao criar parcelamento no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
