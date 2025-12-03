import { injectable } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasPaymentsRequest,
  IListAsaasPaymentsResponse,
} from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class ListPaymentsService {
  constructor(private readonly asaasBaseService: AsaasBaseService) {}

  listPayments = async (
    request?: IListAsaasPaymentsRequest
  ): Promise<IListAsaasPaymentsResponse | null> => {
    try {
      const params = new URLSearchParams();

      if (request?.installment) {
        params.append('installment', request.installment);
      }

      if (request?.offset !== undefined) {
        params.append('offset', request.offset.toString());
      }

      if (request?.limit !== undefined) {
        params.append('limit', request.limit.toString());
      }

      if (request?.customer) {
        params.append('customer', request.customer);
      }

      if (request?.customerGroupName) {
        params.append('customerGroupName', request.customerGroupName);
      }

      if (request?.billingType) {
        params.append('billingType', request.billingType);
      }

      if (request?.status) {
        params.append('status', request.status);
      }

      if (request?.subscription) {
        params.append('subscription', request.subscription);
      }

      if (request?.externalReference) {
        params.append('externalReference', request.externalReference);
      }

      if (request?.paymentDate) {
        params.append('paymentDate', request.paymentDate);
      }

      if (request?.invoiceStatus) {
        params.append('invoiceStatus', request.invoiceStatus);
      }

      if (request?.estimatedCreditDate) {
        params.append('estimatedCreditDate', request.estimatedCreditDate);
      }

      if (request?.pixQrCodeId) {
        params.append('pixQrCodeId', request.pixQrCodeId);
      }

      if (request?.anticipated !== undefined) {
        params.append('anticipated', request.anticipated.toString());
      }

      if (request?.anticipable !== undefined) {
        params.append('anticipable', request.anticipable.toString());
      }

      if (request?.dateCreatedGe) {
        params.append('dateCreated[ge]', request.dateCreatedGe);
      }

      if (request?.dateCreatedLe) {
        params.append('dateCreated[le]', request.dateCreatedLe);
      }

      if (request?.paymentDateGe) {
        params.append('paymentDate[ge]', request.paymentDateGe);
      }

      if (request?.paymentDateLe) {
        params.append('paymentDate[le]', request.paymentDateLe);
      }

      if (request?.estimatedCreditDateGe) {
        params.append('estimatedCreditDate[ge]', request.estimatedCreditDateGe);
      }

      if (request?.estimatedCreditDateLe) {
        params.append('estimatedCreditDate[le]', request.estimatedCreditDateLe);
      }

      if (request?.dueDateGe) {
        params.append('dueDate[ge]', request.dueDateGe);
      }

      if (request?.dueDateLe) {
        params.append('dueDate[le]', request.dueDateLe);
      }

      if (request?.user) {
        params.append('user', request.user);
      }

      const queryString = params.toString();
      const url = queryString ? `/v3/payments?${queryString}` : '/v3/payments';

      const response = await this.asaasBaseService
        .getAxiosInstance()
        .get<IListAsaasPaymentsResponse>(url);

      if (response.status === 200 && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          'Erro ao listar cobranças no Asaas:',
          error.response?.data
        );
      } else {
        console.error('Erro desconhecido ao listar cobranças no Asaas:', error);
      }
      return null;
    }
  };
}
