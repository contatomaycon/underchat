import * as schema from '@core/models';
import { userDocument } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { IUpdateUserDocument } from '@core/common/interfaces/IUpdateUserDocument';

@injectable()
export class UserDocumentUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: IUpdateUserDocument
  ): Partial<typeof userDocument.$inferInsert> {
    const inputUpdate: Partial<typeof userDocument.$inferInsert> = {};

    if (input.user_document_type_id) {
      inputUpdate.user_document_type_id = input.user_document_type_id;
    }

    if (input.document) {
      inputUpdate.document = input.document;
    }

    if (input.document_partial) {
      inputUpdate.document_partial = input.document_partial;
    }

    return inputUpdate;
  }

  updateUserDocumentById = async (
    userId: string,
    input: IUpdateUserDocument
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.db
      .update(userDocument)
      .set(updateInput)
      .where(eq(userDocument.user_id, userId))
      .execute();

    return result.rowCount === 1;
  };
}
