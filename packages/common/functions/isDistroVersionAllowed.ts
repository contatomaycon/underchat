import { EAllowedDistroVersion } from '../enums/EAllowedDistroVersion';
import { IDistroInfo } from '../interfaces/IDistroInfo';

export function isDistroVersionAllowed(info: IDistroInfo): boolean {
  const key = `${info.distro}:${info.version}`;

  return Object.values(EAllowedDistroVersion).includes(
    key as EAllowedDistroVersion
  );
}
