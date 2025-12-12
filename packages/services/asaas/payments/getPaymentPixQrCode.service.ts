import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IGetAsaasPaymentPixQrCodeResponse } from '@core/common/interfaces/IAsaasPayment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class GetPaymentPixQrCodeService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getPaymentPixQrCode = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentPixQrCodeResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IGetAsaasPaymentPixQrCodeResponse>(
          `/v3/payments/${paymentId}/pixQrCode`
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

        throw new Error('Erro ao obter QR Code Pix da cobrança');
      }

      throw new Error('Erro desconhecido ao obter QR Code Pix da cobrança');
    }
  };
}
