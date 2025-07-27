import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';

export const workerCreatePermissions = [
  EGeneralPermissions.full_access,
  EWorkerPermissions.create_worker,
];

export const workerViewPermissions = [
  EGeneralPermissions.full_access,
  EWorkerPermissions.view_worker,
];

export const workerEditPermissions = [
  EGeneralPermissions.full_access,
  EWorkerPermissions.update_worker,
];
