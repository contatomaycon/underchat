import * as schema from '@core/models';
import { userDocumentType } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { count, eq } from 'drizzle-orm';

@injectable()
export class UserDocumentTypeViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsUserDocumentTypeById = async (
    userDocumentTypeId: string
  ): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(userDocumentType)
      .where(eq(userDocumentType.user_document_type_id, userDocumentTypeId))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
