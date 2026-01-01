import { createMongoAbility, MongoAbility } from '@casl/ability';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';

export type AppAbility = MongoAbility<[EPermissionsRoles, EPermissionsRoles]>;

export const ability =
  createMongoAbility<[EPermissionsRoles, EPermissionsRoles]>();

export const updateAbilityPermissions = (
  permissions: EPermissionsRoles[] = []
): void => {
  const roles = permissions.map((permission) => ({
    action: permission,
    subject: permission,
  }));

  ability.update(roles);
};
