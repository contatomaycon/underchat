import { EServerBuildType } from '../enums/EServerBuildType';

export interface IMarkServerBuildItemSuccessInput {
  server_build_job_id: string;
  build_type: EServerBuildType;
  version: string;
  harbor_registry: string;
  harbor_repository: string;
  image_reference: string;
}
