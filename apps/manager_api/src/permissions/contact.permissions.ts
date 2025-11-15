import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EContactPermissions } from '@core/common/enums/EPermissions/contact';

export const contactListPermissions = [
  EGeneralPermissions.full_access,
  EContactPermissions.contact_list,
];
export const contactViewPermissions = [
  EGeneralPermissions.full_access,
  EContactPermissions.contact_view,
];
export const contactDeletePermissions = [
  EGeneralPermissions.full_access,
  EContactPermissions.contact_delete,
];
export const contactUpdatePermissions = [
  EGeneralPermissions.full_access,
  EContactPermissions.contact_update,
];
export const contactCreatePermissions = [
  EGeneralPermissions.full_access,
  EContactPermissions.contact_create,
];
