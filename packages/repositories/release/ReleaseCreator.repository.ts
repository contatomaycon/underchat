import * as schema from '@core/models';
import { release, releaseAccess } from '@core/models';
import { CreateReleaseRequest } from '@core/schema/release/createRelease/request.schema';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { EReleaseStatus } from '@core/common/enums/EReleaseStatus';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class ReleaseCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createRelease = async (
    input: CreateReleaseRequest,
    accountId: string | null,
    userAccountId: string | null,
    hasFullAccess: boolean,
    createdByUserId: string
  ): Promise<string | null> => {
    return this.dbRw.transaction(async (tx) => {
      const releaseId = await this.createReleaseRecord(
        tx,
        input,
        accountId,
        createdByUserId
      );

      await this.createReleaseAccessRecord(
        tx,
        releaseId,
        input,
        userAccountId,
        hasFullAccess
      );

      return releaseId;
    });
  };

  private readonly createReleaseRecord = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: CreateReleaseRequest,
    accountId: string | null,
    createdByUserId: string
  ): Promise<string> => {
    const releaseId = uuidv7();

    await tx.insert(release).values({
      release_id: releaseId,
      account_id: accountId,
      created_by_user_id: createdByUserId,
      type: input.type,
      status: EReleaseStatus.active,
      title: input.title,
      message: input.message,
    });

    return releaseId;
  };

  private readonly createReleaseAccessRecord = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    releaseId: string,
    input: CreateReleaseRequest,
    userAccountId: string | null,
    hasFullAccess: boolean
  ): Promise<void> => {
    const releaseAccessId = uuidv7();

    const isForAll =
      (input.account_id === null || input.account_id === undefined) &&
      (input.user_id === null || input.user_id === undefined) &&
      (input.permission_role_id === null ||
        input.permission_role_id === undefined);

    let accountIdToUse: string | null;

    if (!hasFullAccess) {
      accountIdToUse = userAccountId;
    } else {
      if (isForAll) {
        accountIdToUse = null;
      } else {
        accountIdToUse = input.account_id ?? null;
      }
    }

    await tx.insert(releaseAccess).values({
      release_access_id: releaseAccessId,
      release_id: releaseId,
      account_id: accountIdToUse,
      user_id: input.user_id ?? null,
      permission_role_id: input.permission_role_id ?? null,
    });
  };
}
