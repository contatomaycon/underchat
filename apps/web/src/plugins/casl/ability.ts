import { createMongoAbility, MongoAbility } from '@casl/ability';
import { EPermissionsRoles } from '@main/common/enums/EPermissions';

export type Subjects = 'all';

export type AppAbility = MongoAbility<[EPermissionsRoles, Subjects]>;

export const ability = createMongoAbility<[EPermissionsRoles, Subjects]>();
