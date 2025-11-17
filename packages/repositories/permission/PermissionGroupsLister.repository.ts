import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { ListPermissionGroupsResponse } from '@core/schema/permission/listPermissionGroups/response.schema';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { IPermissionGroupRow } from '@core/common/interfaces/IPermissionGroupRow';
import { ERouteModule } from '@core/common/enums/ERouteModule';

@injectable()
export class PermissionGroupsListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listPermissionGroupsByPermissionRoleId = async (
    permissionRoleId: string,
    moduleName: ERouteModule
  ): Promise<ListPermissionGroupsResponse> => {
    const query = `
      WITH RoleGroupPermissions AS (
        SELECT DISTINCT
          pra.permission_action_group_id
        FROM "permission_role" pr
        JOIN "permission_role_action" pra ON pra.permission_role_id = pr.permission_role_id
        JOIN "permission_action_groups" pag ON pag.permission_action_group_id = pra.permission_action_group_id
        JOIN "permission_action" paa ON paa.permission_action_group_id = pag.permission_action_group_id
        JOIN "permission_module" pm ON paa.permission_module_id = pm.module_id
        WHERE pr.permission_role_id = '${permissionRoleId}' 
          AND pr.deleted_at IS NULL
          AND pra.permission_action_group_id IS NOT NULL
          AND pm.module = '${moduleName}'
      ),
      RoleIndividualPermissions AS (
        SELECT DISTINCT
          paa.permission_action_id,
          paa.permission_action_group_id
        FROM "permission_role" pr
        JOIN "permission_role_action" pra ON pra.permission_role_id = pr.permission_role_id
        JOIN "permission_action" paa ON paa.permission_action_id = pra.permission_action_id
        JOIN "permission_module" pm ON paa.permission_module_id = pm.module_id
        WHERE pr.permission_role_id = '${permissionRoleId}' 
          AND pr.deleted_at IS NULL
          AND pra.permission_action_id IS NOT NULL
          AND pm.module = '${moduleName}'
          AND paa.permission_action_group_id NOT IN (SELECT permission_action_group_id FROM RoleGroupPermissions)
      ),
      HasFullAccess AS (
        SELECT COUNT(*) > 0 AS has_full_access
        FROM "permission_role" pr
        JOIN "permission_role_action" pra ON pra.permission_role_id = pr.permission_role_id
        JOIN "permission_action" paa ON paa.permission_action_id = pra.permission_action_id
        JOIN "permission_module" pm ON paa.permission_module_id = pm.module_id
        WHERE pr.permission_role_id = '${permissionRoleId}' 
          AND pr.deleted_at IS NULL
          AND pra.permission_action_id IS NOT NULL
          AND pm.module = '${moduleName}'
          AND paa.action = '${EGeneralPermissions.full_access}'
      ),
      HasFullAccessGroup AS (
        SELECT COUNT(*) > 0 AS has_full_access_group
        FROM "permission_role" pr
        JOIN "permission_role_action" pra ON pra.permission_role_id = pr.permission_role_id
        JOIN "permission_action_groups" pag ON pag.permission_action_group_id = pra.permission_action_group_id
        JOIN "permission_action" paa ON paa.permission_action_group_id = pag.permission_action_group_id
        JOIN "permission_module" pm ON paa.permission_module_id = pm.module_id
        WHERE pr.permission_role_id = '${permissionRoleId}' 
          AND pr.deleted_at IS NULL
          AND pra.permission_action_group_id IS NOT NULL
          AND pm.module = '${moduleName}'
          AND pag.action = 'full_access_group'
      ),
      AllGroups AS (
        SELECT DISTINCT
          pag.permission_action_group_id,
          pag.name AS group_name,
          pag.description AS group_description,
          pag.action AS group_action,
          pag.created_at AS group_created_at,
          pag.updated_at AS group_updated_at
        FROM "permission_action_groups" pag
        JOIN "permission_action" paa ON paa.permission_action_group_id = pag.permission_action_group_id
        JOIN "permission_module" pm ON paa.permission_module_id = pm.module_id
        WHERE pm.module = '${moduleName}'
      ),
      FilteredGroups AS (
        SELECT 
          ag.permission_action_group_id,
          ag.group_name,
          ag.group_description,
          ag.group_action,
          ag.group_created_at,
          ag.group_updated_at
        FROM AllGroups ag
        CROSS JOIN HasFullAccess hfa
        CROSS JOIN HasFullAccessGroup hfag
        WHERE hfa.has_full_access = true
          OR hfag.has_full_access_group = true
          OR ag.permission_action_group_id IN (SELECT permission_action_group_id FROM RoleGroupPermissions)
          OR ag.permission_action_group_id IN (SELECT permission_action_group_id FROM RoleIndividualPermissions)
      ),
      GroupPermissions AS (
        SELECT 
          fg.permission_action_group_id,
          fg.group_name,
          fg.group_description,
          fg.group_action,
          fg.group_created_at,
          fg.group_updated_at,
          paa.permission_action_id,
          paa.action,
          paa.name,
          paa.description,
          paa.created_at,
          paa.updated_at
        FROM FilteredGroups fg
        JOIN "permission_action" paa ON paa.permission_action_group_id = fg.permission_action_group_id
        JOIN "permission_module" pm ON paa.permission_module_id = pm.module_id
        CROSS JOIN HasFullAccess hfa
        CROSS JOIN HasFullAccessGroup hfag
        WHERE pm.module = '${moduleName}'
          AND (hfa.has_full_access = true OR hfag.has_full_access_group = true)
        UNION ALL
        SELECT 
          fg.permission_action_group_id,
          fg.group_name,
          fg.group_description,
          fg.group_action,
          fg.group_created_at,
          fg.group_updated_at,
          NULL::uuid AS permission_action_id,
          NULL::varchar AS action,
          NULL::varchar AS name,
          NULL::varchar AS description,
          NULL::timestamptz AS created_at,
          NULL::timestamptz AS updated_at
        FROM FilteredGroups fg
        CROSS JOIN HasFullAccess hfa
        CROSS JOIN HasFullAccessGroup hfag
        WHERE fg.permission_action_group_id IN (SELECT permission_action_group_id FROM RoleGroupPermissions)
          AND hfa.has_full_access = false
          AND hfag.has_full_access_group = false
        UNION ALL
        SELECT 
          fg.permission_action_group_id,
          fg.group_name,
          fg.group_description,
          fg.group_action,
          fg.group_created_at,
          fg.group_updated_at,
          paa.permission_action_id,
          paa.action,
          paa.name,
          paa.description,
          paa.created_at,
          paa.updated_at
        FROM FilteredGroups fg
        JOIN "permission_action" paa ON paa.permission_action_group_id = fg.permission_action_group_id
        JOIN "permission_module" pm ON paa.permission_module_id = pm.module_id
        CROSS JOIN HasFullAccess hfa
        CROSS JOIN HasFullAccessGroup hfag
        WHERE fg.permission_action_group_id NOT IN (SELECT permission_action_group_id FROM RoleGroupPermissions)
          AND pm.module = '${moduleName}'
          AND hfa.has_full_access = false
          AND hfag.has_full_access_group = false
          AND paa.permission_action_id IN (SELECT permission_action_id FROM RoleIndividualPermissions)
      )
      SELECT 
        gp.permission_action_group_id,
        gp.group_name,
        gp.group_description,
        gp.group_action,
        gp.group_created_at,
        gp.group_updated_at,
        gp.permission_action_id,
        gp.action,
        gp.name,
        gp.description,
        gp.created_at,
        gp.updated_at
      FROM GroupPermissions gp
      ORDER BY gp.group_name, gp.name;
    `;

    const result = await this.db.execute(query);

    if (result?.rowCount === 0) {
      return [];
    }

    const groupsMap = new Map<
      string,
      {
        permission_action_group_id: string;
        name: string;
        description: string | null;
        action: string;
        created_at: string;
        updated_at: string;
        permissions: Array<{
          permission_action_id: string;
          action: string;
          name: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        }>;
      }
    >();

    for (const row of result.rows as unknown as IPermissionGroupRow[]) {
      const groupId = row.permission_action_group_id;

      if (!groupsMap.has(groupId)) {
        groupsMap.set(groupId, {
          permission_action_group_id: groupId,
          name: row.group_name,
          description: row.group_description,
          action: row.group_action,
          created_at: row.group_created_at,
          updated_at: row.group_updated_at,
          permissions: [],
        });
      }

      if (
        row.permission_action_id &&
        row.action &&
        row.name &&
        row.created_at &&
        row.updated_at
      ) {
        const group = groupsMap.get(groupId)!;
        group.permissions.push({
          permission_action_id: row.permission_action_id,
          action: row.action,
          name: row.name,
          description: row.description,
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
      }
    }

    return Array.from(groupsMap.values()) as ListPermissionGroupsResponse;
  };
}
