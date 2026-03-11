import { EServerBuildJobStatus } from '../enums/EServerBuildJobStatus';
import { ServerBuildJobItem } from '@core/schema/server/viewServerBuild/response.schema';

export interface IServerBuildJobWithItems {
  server_build_job_id: string;
  requested_by: string | null;
  version: string;
  status: EServerBuildJobStatus;
  error_message: string | null;
  created_at: string | null;
  updated_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  items: ServerBuildJobItem[];
}
