import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { AsaasBaseService } from '../asaasBase.service';
import {
  IListAsaasPaymentsRequest,
  IListAsaasPaymentsResponse,
} from '@core/common/interfaces/IAsaasPayment';
import { IAsaasErrorResponse } from '@core/common/interfaces/IAsaasCreditCard';

@injectable()
export class ListPaymentsService {
  constructor(
    @inject(AsaasBaseService)
    private readonly asaasBaseService: AsaasBaseService
  ) {}

  private buildQueryParams(
    request?: IListAsaasPaymentsRequest
  ): URLSearchParams {
    const params = new URLSearchParams();

    if (!request) {
      return params;
    }

    this.addStringParams(params, request);
    this.addNumericParams(params, request);
    this.addBooleanParams(params, request);
    this.addDateRangeParams(params, request);

    return params;
  }

  private addStringParams(
    params: URLSearchParams,
    request: IListAsaasPaymentsRequest
  ): void {
    const stringFields: Array<
      keyof Pick<
        IListAsaasPaymentsRequest,
        | 'installment'
        | 'customer'
        | 'customerGroupName'
        | 'billingType'
        | 'status'
        | 'subscription'
        | 'externalReference'
        | 'paymentDate'
        | 'invoiceStatus'
        | 'estimatedCreditDate'
        | 'pixQrCodeId'
        | 'user'
      >
    > = [
      'installment',
      'customer',
      'customerGroupName',
      'billingType',
      'status',
      'subscription',
      'externalReference',
      'paymentDate',
      'invoiceStatus',
      'estimatedCreditDate',
      'pixQrCodeId',
      'user',
    ];

    for (const field of stringFields) {
      const value = request[field];
      if (value) {
        params.append(field, value);
      }
    }
  }

  private addNumericParams(
    params: URLSearchParams,
    request: IListAsaasPaymentsRequest
  ): void {
    if (request.offset !== undefined) {
      params.append('offset', request.offset.toString());
    }

    if (request.limit !== undefined) {
      params.append('limit', request.limit.toString());
    }
  }

  private addBooleanParams(
    params: URLSearchParams,
    request: IListAsaasPaymentsRequest
  ): void {
    if (request.anticipated !== undefined) {
      params.append('anticipated', request.anticipated.toString());
    }

    if (request.anticipable !== undefined) {
      params.append('anticipable', request.anticipable.toString());
    }
  }

  private addDateRangeParams(
    params: URLSearchParams,
    request: IListAsaasPaymentsRequest
  ): void {
    const dateRanges: Array<{
      geField: keyof IListAsaasPaymentsRequest;
      leField: keyof IListAsaasPaymentsRequest;
      paramName: string;
    }> = [
      {
        geField: 'dateCreatedGe',
        leField: 'dateCreatedLe',
        paramName: 'dateCreated',
      },
      {
        geField: 'paymentDateGe',
        leField: 'paymentDateLe',
        paramName: 'paymentDate',
      },
      {
        geField: 'estimatedCreditDateGe',
        leField: 'estimatedCreditDateLe',
        paramName: 'estimatedCreditDate',
      },
      {
        geField: 'dueDateGe',
        leField: 'dueDateLe',
        paramName: 'dueDate',
      },
    ];

    for (const range of dateRanges) {
      const geValue = request[range.geField];
      const leValue = request[range.leField];

      if (geValue) {
        params.append(`${range.paramName}[ge]`, geValue as string);
      }

      if (leValue) {
        params.append(`${range.paramName}[le]`, leValue as string);
      }
    }
  }

  listPayments = async (
    request?: IListAsaasPaymentsRequest
  ): Promise<IListAsaasPaymentsResponse | null> => {
    try {
      const params = this.buildQueryParams(request);
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
        const errorData = error.response?.data as IAsaasErrorResponse;

        if (errorData?.errors && errorData.errors.length > 0) {
          const firstErrorDescription = errorData.errors[0].description;

          throw new Error(firstErrorDescription);
        }

        throw new Error('Erro ao listar cobranças');
      }

      throw new Error('Erro desconhecido ao listar cobranças');
    }
  };
}
