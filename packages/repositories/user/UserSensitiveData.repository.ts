import { IUserSensitiveDataDecrypted } from '@core/common/interfaces/IUserSensitiveDataDecrypted';
import * as schema from '@core/models';
import { user, userInfo, userDocument, userAddress } from '@core/models';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class UserSensitiveDataRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  getUserSensitiveDataById = async (
    userId: string
  ): Promise<IUserSensitiveDataDecrypted | null> => {
    const userResult = await this.db
      .select({
        email: user.email,
      })
      .from(user)
      .where(and(eq(user.user_id, userId), isNull(user.deleted_at)))
      .execute();

    if (!userResult.length) {
      return null;
    }

    const [userInfoResult, userDocumentResult, userAddressResult] =
      await Promise.all([
        this.db
          .select({
            phone: userInfo.phone,
          })
          .from(userInfo)
          .where(eq(userInfo.user_id, userId))
          .execute(),

        this.db
          .select({
            document: userDocument.document,
          })
          .from(userDocument)
          .where(eq(userDocument.user_id, userId))
          .execute(),

        this.db
          .select({
            address1: userAddress.address1,
            address2: userAddress.address2,
          })
          .from(userAddress)
          .where(
            and(eq(userAddress.user_id, userId), isNull(userAddress.deleted_at))
          )
          .execute(),
      ]);

    return {
      phone: userInfoResult[0]?.phone ?? null,
      email: userResult[0].email ?? null,
      document: userDocumentResult[0]?.document ?? null,
      address1: userAddressResult[0]?.address1 ?? null,
      address2: userAddressResult[0]?.address2 ?? null,
    };
  };
}
