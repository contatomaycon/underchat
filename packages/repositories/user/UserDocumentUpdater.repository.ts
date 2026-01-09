import * as schema from '@core/models';
import { userDocument } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { IUpdateUserDocument } from '@core/common/interfaces/IUpdateUserDocument';

@injectable()
export class UserDocumentUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: IUpdateUserDocument
  ): Partial<typeof userDocument.$inferInsert> {
    const inputUpdate: Partial<typeof userDocument.$inferInsert> = {};

    if (input.user_document_type_id !== undefined) {
      if (input.user_document_type_id !== null) {
        inputUpdate.user_document_type_id = input.user_document_type_id;
      }
    }

    if (input.document !== undefined) {
      inputUpdate.document = input.document;
    }

    if (input.document_partial !== undefined) {
      inputUpdate.document_partial = input.document_partial;
    }

    if (input.document_c !== undefined) {
      inputUpdate.document_c = input.document_c;
    }

    return inputUpdate;
  }

  updateUserDocumentById = async (
    userId: string,
    input: IUpdateUserDocument
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    if (Object.keys(updateInput).length === 0) {
      return false;
    }

    const result = await this.dbRw
      .update(userDocument)
      .set(updateInput)
      .where(eq(userDocument.user_id, userId))
      .execute();

    return result.rowCount === 1;
  };

  deleteUserDocumentById = async (userId: string): Promise<boolean> => {
    const result = await this.dbRw
      .delete(userDocument)
      .where(eq(userDocument.user_id, userId))
      .execute();

    return (result.rowCount ?? 0) >= 0;
  };

  existsUserDocumentByUserId = async (userId: string): Promise<boolean> => {
    const result = await this.dbRw
      .select({ user_document_id: userDocument.user_document_id })
      .from(userDocument)
      .where(eq(userDocument.user_id, userId))
      .limit(1)
      .execute();

    return result.length > 0;
  };
}
