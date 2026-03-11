import { EServerBuildType } from '../enums/EServerBuildType';

export interface IRunServerBuildCommandOptions {
  cwd: string;
  stdin?: string;
  displayArgs?: string[];
  buildType?: EServerBuildType | null;
  emitRealtimeLogs?: boolean;
}
