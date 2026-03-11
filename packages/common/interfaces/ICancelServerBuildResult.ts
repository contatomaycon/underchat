import { EServerBuildJobStatus } from '../enums/EServerBuildJobStatus';

export interface ICancelServerBuildResult {
  server_build_job_id: string;
  previous_status: EServerBuildJobStatus;
}
