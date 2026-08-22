import { EServerBuildType } from '@core/common/enums/EServerBuildType';

export interface IHarborBuildVersionByType {
  version: string;
  created_at: string | null;
  image_references: Partial<Record<EServerBuildType, string>>;
  harbor_repositories: Partial<Record<EServerBuildType, string>>;
}
