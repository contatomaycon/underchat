import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';

export const planListPermissions = [
  EGeneralPermissions.full_access,
  EPlanPermissions.plan_list,
];
export const planViewPermissions = [
  EGeneralPermissions.full_access,
  EPlanPermissions.plan_view,
];
export const planDeletePermissions = [
  EGeneralPermissions.full_access,
  EPlanPermissions.plan_delete,
];
export const planUpdatePermissions = [
  EGeneralPermissions.full_access,
  EPlanPermissions.plan_update,
];
export const planCreatePermissions = [
  EGeneralPermissions.full_access,
  EPlanPermissions.plan_create,
];
