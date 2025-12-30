import * as schema from '@core/models';
import { userInfo, userDocument } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class AccountSettingsAdditionalInfoViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewAdditionalInfoByUserId = async (userId: string) => {
    const userInfoResult = await this.dbRo.query.userInfo.findFirst({
      where: and(eq(userInfo.user_id, userId), isNull(userInfo.deleted_at)),
      columns: {
        phone_ddi: true,
        phone_partial: true,
        name: true,
        last_name: true,
        birth_date: true,
        photo: true,
      },
    });

    const userDocumentResult = await this.dbRo.query.userDocument.findFirst({
      where: eq(userDocument.user_id, userId),
      with: {
        udt: {
          columns: {
            user_document_type_id: true,
          },
        },
      },
      columns: {
        document_partial: true,
      },
    });

    return {
      phone_ddi: userInfoResult?.phone_ddi ?? null,
      phone_partial: userInfoResult?.phone_partial ?? null,
      name: userInfoResult?.name ?? null,
      last_name: userInfoResult?.last_name ?? null,
      birth_date: userInfoResult?.birth_date ?? null,
      photo: userInfoResult?.photo ?? null,
      document_type_id: userDocumentResult?.udt?.user_document_type_id ?? null,
      document_partial: userDocumentResult?.document_partial ?? null,
    };
  };
}
