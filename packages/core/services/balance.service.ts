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

  public async createWorker(
    t: TFunction<'translation', undefined>,
    input: IViewWorkerBalancerServer,
    payload: BalanceCreateWorkerRequest
  ): Promise<BalanceCreateWorkerResponse> {
    try {
      const axiosInstance = this.createAxiosInstance(input);

      const {
        data: { status, data },
      } = await axiosInstance.post<IApiResponse<BalanceCreateWorkerResponse>>(
        '/worker',
        payload
      );

      if (!status || !data) {
        throw new Error(t('worker_creation_failed'));
      }

      return data;
    } catch (error) {
      console.log('Error creating worker in balance service', error);

      throw new Error(t('worker_creation_failed'));
    }
  }

  public async deleteWorker(
    t: TFunction<'translation', undefined>,
    input: IViewWorkerBalancerServer,
    workerId: string
  ): Promise<IApiResponse<null>> {
    try {
      const axiosInstance = this.createAxiosInstance(input);

      const { data } = await axiosInstance.delete<IApiResponse<null>>(
        `/worker/${workerId}`
      );

      if (!data.status) {
        throw new Error(t('worker_delete_error'));
      }

      return data;
    } catch {
      throw new Error(t('worker_delete_error'));
    }
  }
}
