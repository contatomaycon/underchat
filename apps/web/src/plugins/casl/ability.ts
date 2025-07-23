import { createMongoAbility, MongoAbility } from '@casl/ability';
import { EPermissionsRoles } from '@main/common/enums/EPermissions';

export type AppAbility = MongoAbility<[EPermissionsRoles, EPermissionsRoles]>;

export const ability =
  createMongoAbility<[EPermissionsRoles, EPermissionsRoles]>();
