import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EFinancialPermissions } from '@core/common/enums/EPermissions/financial';

export const financialViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EFinancialPermissions.financial_group,
  EFinancialPermissions.financial_view,
];
