import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EExpenditurePermissions } from '@core/common/enums/EPermissions/expenditure';

export const expenditureViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EExpenditurePermissions.expenditure_group,
  EExpenditurePermissions.expenditure_view,
];
export const expenditureDeletePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EExpenditurePermissions.expenditure_group,
  EExpenditurePermissions.expenditure_delete,
];
export const expenditureUpdatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EExpenditurePermissions.expenditure_group,
  EExpenditurePermissions.expenditure_update,
];
export const expenditureCreatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EExpenditurePermissions.expenditure_group,
  EExpenditurePermissions.expenditure_create,
];
