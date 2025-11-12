import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EContactGroupPermissions } from '@core/common/enums/EPermissions/contactGroup';

export const contactGroupListPermissions = [
  EGeneralPermissions.full_access,
  EContactGroupPermissions.contact_group_list,
];
export const contactGroupViewPermissions = [
  EGeneralPermissions.full_access,
  EContactGroupPermissions.contact_group_view,
];
export const contactGroupDeletePermissions = [
  EGeneralPermissions.full_access,
  EContactGroupPermissions.contact_group_delete,
];
export const contactGroupUpdatePermissions = [
  EGeneralPermissions.full_access,
  EContactGroupPermissions.contact_group_update,
];
export const contactGroupCreatePermissions = [
  EGeneralPermissions.full_access,
  EContactGroupPermissions.contact_group_create,
];
