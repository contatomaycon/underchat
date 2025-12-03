import { injectable } from 'tsyringe';
import axios, { AxiosInstance } from 'axios';
import { asaasEnvironment } from '@core/config/environments';

@injectable()
export class AsaasBaseService {
  private axiosInstance: AxiosInstance | null = null;

  getAxiosInstance = (): AxiosInstance => {
    if (!this.axiosInstance) {
      const baseURL = asaasEnvironment.getAsaasHost();
      const accessToken = asaasEnvironment.getAsaasToken();

      this.axiosInstance = axios.create({
        baseURL,
        headers: {
          'Content-Type': 'application/json',
          access_token: accessToken,
        },
      });
    }

    return this.axiosInstance;
  };
}
