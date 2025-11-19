import { EWorkerProfileStatusType } from '@core/common/enums/EWorkerProfileStatusType';

export interface IProfileStatusMessage {
  worker_id: string;
  account_id: string;
  worker_profile_status_id: string;
  worker_profile_status_type_id: EWorkerProfileStatusType;
  value: string;
  is_permanent: boolean;
}
