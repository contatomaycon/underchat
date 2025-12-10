import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';

export const planViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EPlanPermissions.plan_group,
  EPlanPermissions.plan_view,
];
export const planDeletePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EPlanPermissions.plan_group,
  EPlanPermissions.plan_delete,
];
export const planUpdatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EPlanPermissions.plan_group,
  EPlanPermissions.plan_update,
];
export const planCreatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EPlanPermissions.plan_group,
  EPlanPermissions.plan_create,
];
export const planInvoicePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EPlanPermissions.plan_group,
  EPlanPermissions.plan_invoice,
];
