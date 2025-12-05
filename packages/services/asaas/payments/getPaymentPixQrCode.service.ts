import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IGetAsaasPaymentPixQrCodeResponse } from '@core/common/interfaces/IAsaasPayment';

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
        console.error(
          'Erro ao obter QR Code Pix da cobrança no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao obter QR Code Pix da cobrança no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
