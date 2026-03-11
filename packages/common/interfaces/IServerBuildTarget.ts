import { EServerBuildType } from '../enums/EServerBuildType';

export interface IServerBuildTarget {
  buildType: EServerBuildType;
  imageName: string;
  dockerfilePath: string;
}
