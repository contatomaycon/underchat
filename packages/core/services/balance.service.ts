import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { IViewWorkerBalancerServer } from '@core/common/interfaces/IViewWorkerBalancerServer';
import { BalanceCreateWorkerRequest } from '@core/schema/worker/balanceCreateWorker/request.schema';
import { BalanceCreateWorkerResponse } from '@core/schema/worker/balanceCreateWorker/response.schema';
import axios, { AxiosInstance } from 'axios';
import { TFunction } from 'i18next';
import { injectable } from 'tsyringe';

@injectable()
export class BalanceService {
  constructor() {}

  createAxiosInstance = (input: IViewWorkerBalancerServer): AxiosInstance =>
    axios.create({
      baseURL: `${input.web_protocol}://${input.web_domain}:${input.web_port}/v1`,
      timeout: 20000,
      headers: {
        keyapi: input.key,
      },
    });

  createWorker = async (
    t: TFunction<'translation', undefined>,
    input: IViewWorkerBalancerServer,
    payload: BalanceCreateWorkerRequest
  ) => {
    try {
      const axiosInstance = this.createAxiosInstance(input);

      const response = await axiosInstance.post<
        IApiResponse<BalanceCreateWorkerResponse>
      >('/worker', payload);

      const dataResponse = response?.data;

      if (!dataResponse?.status || !dataResponse?.data) {
        throw new Error(t('worker_creation_failed'));
      }

      return dataResponse.data as BalanceCreateWorkerResponse;
    } catch {
      throw new Error(t('worker_creation_failed'));
    }
  };
}
