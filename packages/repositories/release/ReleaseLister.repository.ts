import * as schema from '@core/models';
import { release, releaseAccess, releaseView } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  count,
  desc,
  eq,
  gte,
  SQLWrapper,
  or,
  ilike,
  sql,
  ne,
  isNotNull,
  lte,
} from 'drizzle-orm';
import { EReleaseType } from '@core/common/enums/EReleaseType';
import { ListReleaseRequest } from '@core/schema/release/listRelease/request.schema';
import { ListReleaseResponse } from '@core/schema/release/listRelease/response.schema';
import { EReleaseStatus } from '@core/common/enums/EReleaseStatus';
import { ReleaseViewViewerRepository } from './ReleaseViewViewer.repository';

@injectable()
export class ReleaseListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject(ReleaseViewViewerRepository)
    private readonly releaseViewViewerRepository: ReleaseViewViewerRepository
  ) {}

  /**
   * @param reminderNotificationFeed — true: banner/sino (lembrete só após reminder_at para todos).
   *   false: lista /release (autor ainda vê o próprio lembrete agendado para editar).
   */
  private readonly setFilters = (
    query: ListReleaseRequest,
    accountId: string,
    userId: string,
    permissionRoleId: string,
    userCreatedAt: string | null,
    reminderNotificationFeed: boolean
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    filters.push(eq(release.status, EReleaseStatus.active));

    if (userCreatedAt) {
      filters.push(gte(release.created_at, userCreatedAt));
    }

    if (query.search) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.search ? ilike(release.title, `%${query.search}%`) : undefined,
        query.search ? ilike(release.message, `%${query.search}%`) : undefined,
      ];

      const filteredConditions = conditions.filter(
        (condition): condition is SQLWrapper => condition !== undefined
      );

      if (filteredConditions.length > 0) {
        const combined = or(...filteredConditions);
        if (combined) filters.push(combined);
      }
    }

    if (query.type) {
      filters.push(eq(release.type, query.type));
    }

    const accessConditions = or(
      sql`EXISTS (
        SELECT 1 FROM ${releaseAccess} 
        WHERE ${releaseAccess.release_id} = ${release.release_id}
        AND (
          (
            ${releaseAccess.account_id} IS NOT NULL 
            AND ${releaseAccess.account_id} = ${accountId}
            AND ${releaseAccess.user_id} IS NULL
            AND ${releaseAccess.permission_role_id} IS NULL
          )
          OR (
            ${releaseAccess.account_id} IS NULL
            AND ${releaseAccess.user_id} IS NULL
            AND ${releaseAccess.permission_role_id} IS NULL
          )
          OR (
            (
              ${releaseAccess.account_id} IS NULL 
              OR ${releaseAccess.account_id} = ${accountId}
            )
            AND ${releaseAccess.user_id} = ${userId}
          )
          OR (
            (
              ${releaseAccess.account_id} IS NULL 
              OR ${releaseAccess.account_id} = ${accountId}
            )
            AND ${releaseAccess.permission_role_id} = ${permissionRoleId}
          )
        )
      )`,
      sql`${release.account_id} IS NULL OR ${release.account_id} = ${accountId}`
    ) as SQLWrapper;

    filters.push(accessConditions);

    if (reminderNotificationFeed) {
      filters.push(
        or(
          ne(release.type, EReleaseType.reminder),
          and(
            isNotNull(release.reminder_at),
            lte(release.reminder_at, sql`now()`)
          )
        ) as SQLWrapper
      );
    } else {
      // Lista: lembrete futuro só para o autor (edição); demais só após reminder_at.
      filters.push(
        or(
          ne(release.type, EReleaseType.reminder),
          and(
            isNotNull(release.reminder_at),
            lte(release.reminder_at, sql`now()`)
          ),
          eq(release.created_by_user_id, userId)
        ) as SQLWrapper
      );
    }

    return filters;
  };

  listReleases = async (
    perPage: number,
    currentPage: number,
    query: ListReleaseRequest,
    accountId: string,
    userId: string,
    permissionRoleId: string,
    userCreatedAt: string | null,
    reminderNotificationFeed = false
  ): Promise<ListReleaseResponse[]> => {
    const filters = this.setFilters(
      query,
      accountId,
      userId,
      permissionRoleId,
      userCreatedAt,
      reminderNotificationFeed
    );

    const result = await this.dbRo
      .select({
        release_id: release.release_id,
        created_by_user_id: release.created_by_user_id,
        type: release.type,
        status: release.status,
        title: release.title,
        message: release.message,
        reminder_at: release.reminder_at,
        created_at: release.created_at,
        updated_at: release.updated_at,
      })
      .from(release)
      .where(and(...filters))
      .orderBy(desc(release.created_at))
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [] as ListReleaseResponse[];
    }

    const releaseIds = result.map((item) => item.release_id);
    const viewedReleaseIds =
      await this.releaseViewViewerRepository.findViewedReleaseIds(
        releaseIds,
        userId
      );

    return result.map((item): ListReleaseResponse => {
      const createdAt: string = item.created_at ?? new Date().toISOString();
      const updatedAt: string = item.updated_at ?? new Date().toISOString();

      return {
        release_id: item.release_id,
        created_by_user_id: item.created_by_user_id ?? null,
        type: item.type,
        status: item.status,
        title: item.title,
        message: item.message,
        viewed: viewedReleaseIds.has(item.release_id),
        created_at: createdAt,
        updated_at: updatedAt,
        reminder_at: item.reminder_at ?? null,
      };
    });
  };

  listReleasesTotal = async (
    query: ListReleaseRequest,
    accountId: string,
    userId: string,
    permissionRoleId: string,
    userCreatedAt: string | null,
    reminderNotificationFeed = false
  ): Promise<number> => {
    const filters = this.setFilters(
      query,
      accountId,
      userId,
      permissionRoleId,
      userCreatedAt,
      reminderNotificationFeed
    );

    const result = await this.dbRo
      .select({ count: count() })
      .from(release)
      .where(and(...filters))
      .execute();

    if (result.length === 0) {
      return 0;
    }

    return result[0].count;
  };

  private readonly buildUnreadFilter = (userId: string) =>
    sql`NOT EXISTS (
      SELECT 1 FROM ${releaseView}
      WHERE ${releaseView.release_id} = ${release.release_id}
      AND ${releaseView.user_id} = ${userId}
    )`;

  private readonly executeUnreadCount = async (
    accountId: string,
    userId: string,
    permissionRoleId: string,
    userCreatedAt: string | null,
    reminderNotificationFeed: boolean
  ): Promise<number> => {
    const query = {};
    const filters = this.setFilters(
      query as ListReleaseRequest,
      accountId,
      userId,
      permissionRoleId,
      userCreatedAt,
      reminderNotificationFeed
    );
    const unreadFilter = this.buildUnreadFilter(userId);
    const allFilters = and(...filters, unreadFilter);

    const result = await this.dbRo
      .select({ count: count() })
      .from(release)
      .where(allFilters)
      .execute();

    if (result.length === 0) {
      return 0;
    }

    return result[0].count;
  };

  countUnreadReleases = async (
    accountId: string,
    userId: string,
    permissionRoleId: string,
    userCreatedAt: string | null,
    reminderNotificationFeed = false
  ): Promise<number> =>
    this.executeUnreadCount(
      accountId,
      userId,
      permissionRoleId,
      userCreatedAt,
      reminderNotificationFeed
    );
}
