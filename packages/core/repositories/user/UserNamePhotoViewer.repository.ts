import { IViewUserNamePhoto } from '@core/common/interfaces/IViewUserNamePhoto';
import * as schema from '@core/models';
import { userInfo } from '@core/models';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class UserNamePhotoViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewUserNamePhoto = async (
    userId: string
  ): Promise<IViewUserNamePhoto | null> => {
    const result = await this.db
      .select({
        id: userInfo.user_id,
        name: userInfo.name,
        photo: userInfo.photo,
      })
      .from(userInfo)
      .where(and(eq(userInfo.user_id, userId)))
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0] as IViewUserNamePhoto;
  };
}
