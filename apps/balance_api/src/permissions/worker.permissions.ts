import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';

export const workerCreatePermissions = [
  EGeneralPermissions.full_access,
  EWorkerPermissions.create_worker,
];
