import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

export interface IConfigChannelsRecreateAllPayload {
  account_id: string;
  status?: EWorkerStatus;
  type?: EWorkerType;
  account?: string;
  name?: string;
  number?: string;
}
