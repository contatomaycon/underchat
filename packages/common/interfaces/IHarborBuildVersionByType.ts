import { EServerBuildType } from '@core/common/enums/EServerBuildType';

export interface IHarborBuildVersionByType {
  version: string;
  created_at: string | null;
  image_references: Record<EServerBuildType, string>;
  harbor_repositories: Record<EServerBuildType, string>;
}
