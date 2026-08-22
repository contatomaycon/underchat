import { EServerBuildType } from '@core/common/enums/EServerBuildType';

export interface IDeleteServerBuildVersionResult {
  server_build_version_id: string;
  build_type: EServerBuildType;
  version: string;
}
