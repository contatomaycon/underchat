import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';

export interface IConfigChannelsRecreateAllPayload {
  request_id?: string;
  account_id: string;
  status?: EWorkerStatus;
  type?: EWorkerType;
  session_storage?: EWorkerSessionStorage;
  account?: string;
  name?: string;
  number?: string;
}

export type IConfigChannelsRecreateAllFilters = Omit<
  IConfigChannelsRecreateAllPayload,
  'request_id' | 'account_id'
>;
