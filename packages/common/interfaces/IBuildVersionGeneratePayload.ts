import { EServerBuildType } from '../enums/EServerBuildType';

export type EBuildVersionGenerateTrigger = 'initial' | 'retry';

export interface IBuildVersionGeneratePayload {
  server_build_job_id: string;
  build_type: EServerBuildType;
  trigger?: EBuildVersionGenerateTrigger;
}
