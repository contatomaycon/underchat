import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EIntegrationPermissions } from '@core/common/enums/EPermissions/integration';

export const integrationPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EIntegrationPermissions.integration_group,
];

export const integrationStatusUpdatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EIntegrationPermissions.integration_group,
  EIntegrationPermissions.integration_status_update,
];

export const integrationGenerateKeyPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EIntegrationPermissions.integration_group,
  EIntegrationPermissions.integration_generate_key,
];
