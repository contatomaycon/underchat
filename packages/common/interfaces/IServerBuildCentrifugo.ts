import type {
  ServerBuildJob,
  ServerBuildType,
} from '@core/schema/server/viewServerBuild/response.schema';

export type EServerBuildCentrifugoEvent = 'job_snapshot' | 'command_log';
export type EServerBuildCentrifugoStream = 'stdout' | 'stderr';

export interface IServerBuildCentrifugo {
  event: EServerBuildCentrifugoEvent;
  server_build_job_id: string;
  timestamp: string;
  job: ServerBuildJob | null;
  build_type: ServerBuildType | null;
  stream: EServerBuildCentrifugoStream | null;
  log: string | null;
}
