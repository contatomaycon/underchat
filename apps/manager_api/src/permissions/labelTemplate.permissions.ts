import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { ELabelTemplatePermissions } from '@core/common/enums/EPermissions/labelTemplate';

export const labelTemplateViewPermissions = [
  EGeneralPermissions.full_access,
  ELabelTemplatePermissions.label_template_group,
  ELabelTemplatePermissions.label_view,
];
export const labelTemplateDeletePermissions = [
  EGeneralPermissions.full_access,
  ELabelTemplatePermissions.label_template_group,
  ELabelTemplatePermissions.label_delete,
];
export const labelTemplateUpdatePermissions = [
  EGeneralPermissions.full_access,
  ELabelTemplatePermissions.label_template_group,
  ELabelTemplatePermissions.label_update,
];
export const labelTemplateCreatePermissions = [
  EGeneralPermissions.full_access,
  ELabelTemplatePermissions.label_template_group,
  ELabelTemplatePermissions.label_create,
];
