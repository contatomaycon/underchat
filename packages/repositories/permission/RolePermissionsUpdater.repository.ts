import * as schema from '@core/models';
import {
  permissionRoleAction,
  permissionAction,
  permissionActionGroup,
} from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { v4 as uuidv4 } from 'uuid';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { PermissionGroupRequest } from '@core/schema/permission/updateRolePermissions/request.schema';
import { IPermissionToInsert } from '@core/common/interfaces/IPermissionToInsert';

@injectable()
export class RolePermissionsUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly deleteAllRolePermissions = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    permissionRoleId: string
  ): Promise<void> => {
    await tx
      .delete(permissionRoleAction)
      .where(eq(permissionRoleAction.permission_role_id, permissionRoleId))
      .execute();
  };

  private readonly findPermissionActionIdByAction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    action: string
  ): Promise<string | null> => {
    const result = await tx
      .select({
        permission_action_id: permissionAction.permission_action_id,
      })
      .from(permissionAction)
      .where(eq(permissionAction.action, action))
      .limit(1)
      .execute();

    return result[0]?.permission_action_id ?? null;
  };

  private readonly findPermissionActionGroupIdByAction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    action: string
  ): Promise<string | null> => {
    const result = await tx
      .select({
        permission_action_group_id:
          permissionActionGroup.permission_action_group_id,
      })
      .from(permissionActionGroup)
      .where(eq(permissionActionGroup.action, action))
      .limit(1)
      .execute();

    return result[0]?.permission_action_group_id ?? null;
  };

  private readonly insertRolePermissions = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    permissions: IPermissionToInsert[]
  ): Promise<void> => {
    if (!permissions.length) {
      return;
    }

    await tx.insert(permissionRoleAction).values(permissions).execute();
  };

  updateRolePermissions = async (
    permissionRoleId: string,
    groups: PermissionGroupRequest[]
  ): Promise<void> => {
    await this.db.transaction(async (tx) => {
      await this.deleteAllRolePermissions(tx, permissionRoleId);

      const permissionsToInsert: IPermissionToInsert[] = [];

      const fullAccessGroup = groups.find(
        (group) => group.action === EGeneralPermissions.full_access_group
      );

      if (fullAccessGroup?.selected) {
        const fullAccessGroupId =
          fullAccessGroup.permission_action_group_id ||
          (await this.findPermissionActionGroupIdByAction(
            tx,
            EGeneralPermissions.full_access_group
          ));

        if (fullAccessGroupId) {
          permissionsToInsert.push({
            permission_role_action_id: uuidv4(),
            permission_role_id: permissionRoleId,
            permission_action_group_id: fullAccessGroupId,
          });
        }

        await this.insertRolePermissions(tx, permissionsToInsert);
        return;
      }

      const allPermissions = groups.flatMap((group) => group.permissions);
      const fullAccessPermission = allPermissions.find(
        (permission) =>
          permission.action === EGeneralPermissions.full_access &&
          permission.selected
      );

      if (fullAccessPermission) {
        const fullAccessActionId =
          fullAccessPermission.permission_action_id ||
          (await this.findPermissionActionIdByAction(
            tx,
            EGeneralPermissions.full_access
          ));

        if (fullAccessActionId) {
          permissionsToInsert.push({
            permission_role_action_id: uuidv4(),
            permission_role_id: permissionRoleId,
            permission_action_id: fullAccessActionId,
          });
        }

        await this.insertRolePermissions(tx, permissionsToInsert);
        return;
      }

      const groupsToProcess = groups.filter(
        (group) => group.action !== EGeneralPermissions.full_access_group
      );

      const groupsWithSelected = groupsToProcess.filter(
        (group) => group.selected
      );

      const groupsWithoutSelected = groupsToProcess.filter(
        (group) => !group.selected
      );

      const groupIdsToFetch = groupsWithSelected
        .filter((group) => !group.permission_action_group_id)
        .map((group) => group.action);

      const groupIdsMap = new Map<string, string | null>();

      if (groupIdsToFetch.length > 0) {
        const fetchedGroupIds = await Promise.all(
          groupIdsToFetch.map(async (action) => {
            const groupId = await this.findPermissionActionGroupIdByAction(
              tx,
              action
            );
            return { action, groupId };
          })
        );

        for (const { action, groupId } of fetchedGroupIds) {
          groupIdsMap.set(action, groupId);
        }
      }

      for (const group of groupsWithSelected) {
        const groupId =
          group.permission_action_group_id || groupIdsMap.get(group.action);

        if (groupId) {
          permissionsToInsert.push({
            permission_role_action_id: uuidv4(),
            permission_role_id: permissionRoleId,
            permission_action_group_id: groupId,
          });
        }
      }

      for (const group of groupsWithoutSelected) {
        const selectedPermissions = group.permissions.filter(
          (permission) =>
            permission.selected &&
            permission.action !== EGeneralPermissions.full_access
        );

        for (const permission of selectedPermissions) {
          permissionsToInsert.push({
            permission_role_action_id: uuidv4(),
            permission_role_id: permissionRoleId,
            permission_action_id: permission.permission_action_id,
          });
        }
      }

      await this.insertRolePermissions(tx, permissionsToInsert);
    });
  };
}
