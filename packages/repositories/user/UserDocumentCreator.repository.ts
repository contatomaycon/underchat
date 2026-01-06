import { ICreateUserDocument } from '@core/common/interfaces/ICreateUserDocument';
import * as schema from '@core/models';
import { userDocument } from '@core/models';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class UserDocumentCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createUserDocument = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: ICreateUserDocument,
    userId: string
  ): Promise<boolean> => {
    const userDocumentId = uuidv7();

    const result = await tx
      .insert(userDocument)
      .values({
        user_document_id: userDocumentId,
        user_id: userId,
        user_document_type_id: input.user_document_type_id,
        document: input.document ?? null,
        document_partial: input.document_partial ?? null,
        document_c: input.document_c ?? null,
      })
      .execute();

    return result.rowCount === 1;
  };

  createUserDocumentWithoutTransaction = async (
    input: ICreateUserDocument,
    userId: string
  ): Promise<boolean> => {
    const userDocumentId = uuidv7();

    const result = await this.dbRw
      .insert(userDocument)
      .values({
        user_document_id: userDocumentId,
        user_id: userId,
        user_document_type_id: input.user_document_type_id,
        document: input.document ?? null,
        document_partial: input.document_partial ?? null,
        document_c: input.document_c ?? null,
      })
      .execute();

    return result.rowCount === 1;
  };
}
