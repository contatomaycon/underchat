import * as schema from '@core/models';
import { release, releaseAccess, releaseView } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, gte, or, sql, SQLWrapper } from 'drizzle-orm';
import { ViewReleaseResponse } from '@core/schema/release/viewRelease/response.schema';
import { EReleaseType } from '@core/common/enums/EReleaseType';
import { EReleaseStatus } from '@core/common/enums/EReleaseStatus';

@injectable()
export class ReleaseViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly buildAccessConditions = (
    accountId: string,
    userId: string,
    permissionRoleId: string
  ): SQLWrapper => {
    return or(
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
  };

  private readonly buildViewedField = (userId: string) => {
    return sql<boolean>`EXISTS(
      SELECT 1 
      FROM ${releaseView} 
      WHERE ${releaseView.release_id} = ${release.release_id} 
      AND ${releaseView.user_id} = ${userId}
    )`;
  };

  private readonly mapToViewReleaseResponse = (item: {
    release_id: string;
    account_id: string | null;
    type: EReleaseType;
    status: EReleaseStatus;
    title: string;
    message: string;
    created_at: string | null;
    updated_at: string | null;
    viewed: boolean;
  }): ViewReleaseResponse => {
    const createdAt = item.created_at ?? new Date().toISOString();
    const updatedAt = item.updated_at ?? new Date().toISOString();

    return {
      release_id: item.release_id,
      account_id: item.account_id,
      type: item.type as EReleaseType,
      status: item.status as EReleaseStatus,
      title: item.title,
      message: item.message,
      viewed: item.viewed,
      created_at: createdAt,
      updated_at: updatedAt,
    };
  };

  viewRelease = async (
    releaseId: string,
    accountId: string,
    userId: string,
    permissionRoleId: string,
    userCreatedAt: string | null
  ): Promise<ViewReleaseResponse | null> => {
    const accessConditions = this.buildAccessConditions(
      accountId,
      userId,
      permissionRoleId
    );

    const conditions = [eq(release.release_id, releaseId), accessConditions];
    if (userCreatedAt) {
      conditions.push(gte(release.created_at, userCreatedAt));
    }

    const result = await this.dbRo
      .select({
        release_id: release.release_id,
        account_id: release.account_id,
        type: release.type,
        status: release.status,
        title: release.title,
        message: release.message,
        created_at: release.created_at,
        updated_at: release.updated_at,
        viewed: this.buildViewedField(userId),
      })
      .from(release)
      .where(and(...conditions))
      .limit(1)
      .execute();

    if (!result?.length) {
      return null;
    }

    return this.mapToViewReleaseResponse(result[0]);
  };
}
