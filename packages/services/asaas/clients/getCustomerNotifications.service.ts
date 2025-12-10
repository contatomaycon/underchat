import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import { IListAsaasCustomerNotificationsResponse } from '@core/common/interfaces/IAsaasCustomer';

@injectable()
export class GetCustomerNotificationsService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  getCustomerNotifications = async (
    customerId: string
  ): Promise<IListAsaasCustomerNotificationsResponse | null> => {
    try {
      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasCustomerNotificationsResponse>(
          `/v3/customers/${customerId}/notifications`
        );

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao recuperar notificações do cliente no Asaas:',
          error.response?.data
        );
      } else {
        console.error(
          'Erro desconhecido ao recuperar notificações do cliente no Asaas:',
          error
        );
      }
      return null;
    }
  };
}
