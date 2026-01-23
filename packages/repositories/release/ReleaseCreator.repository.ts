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
    accountId: string | null
  ): Promise<string | null> => {
    return this.dbRw.transaction(async (tx) => {
      const releaseId = await this.createReleaseRecord(tx, input, accountId);

      if (this.shouldCreateReleaseAccess(input)) {
        await this.createReleaseAccessRecord(tx, releaseId, input);
      }

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
    accountId: string | null
  ): Promise<string> => {
    const releaseId = uuidv7();

    await tx.insert(release).values({
      release_id: releaseId,
      account_id: input.account_id ?? accountId,
      type: input.type,
      status: EReleaseStatus.active,
      title: input.title,
      message: input.message,
    });

    return releaseId;
  };

  private readonly shouldCreateReleaseAccess = (
    input: CreateReleaseRequest
  ): boolean => {
    return !(
      input.account_id === null &&
      input.user_id === null &&
      input.permission_role_id === null
    );
  };

  private readonly createReleaseAccessRecord = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    releaseId: string,
    input: CreateReleaseRequest
  ): Promise<void> => {
    const releaseAccessId = uuidv7();

    await tx.insert(releaseAccess).values({
      release_access_id: releaseAccessId,
      release_id: releaseId,
      account_id: input.account_id ?? null,
      user_id: input.user_id ?? null,
      permission_role_id: input.permission_role_id ?? null,
    });
  };
}
