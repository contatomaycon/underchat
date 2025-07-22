import { EUserStatus } from '@core/common/enums/EUserStatus';
import { IAuthenticate } from '@core/common/interfaces/IAuthenticate';
import * as schema from '@core/models';
import {
  user,
  userStatus,
  userInfo,
  userDocument,
  userDocumentType,
  userAddress,
  permissionRole,
} from '@core/models';
import { AuthUserResponse } from '@core/schema/auth/login/response.schema';
import { and, eq, isNull, or } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class AuthRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  authenticate = async (
    input: IAuthenticate
  ): Promise<AuthUserResponse | null> => {
    const result = await this.db
      .select({
        user_id: user.user_id,
        email_partial: user.email_partial,
        status: {
          status_id: userStatus.user_status_id,
          name: userStatus.name,
        },
        info: {
          user_info_id: userInfo.user_info_id,
          name: userInfo.name,
          last_name: userInfo.last_name,
          phone_partial: userInfo.phone_partial,
          photo: userInfo.photo,
          birth_date: userInfo.birth_date,
        },
        type: {
          user_type_id: permissionRole.permission_role_id,
          name: permissionRole.name,
        },
        document: {
          user_document_id: userDocument.user_document_id,
          document_partial: userDocument.document_partial,
          document_type: userDocumentType.name,
        },
        address: {
          user_address_id: userAddress.user_address_id,
          zip_code: userAddress.zip_code,
          address1_partial: userAddress.address1_partial,
          address2_partial: userAddress.address2_partial,
          city: userAddress.city,
          state: userAddress.state,
          district: userAddress.district,
        },
      })
      .from(user)
      .innerJoin(userStatus, eq(userStatus.user_status_id, user.user_status_id))
      .innerJoin(userInfo, eq(userInfo.user_id, user.user_id))
      .innerJoin(
        permissionRole,
        eq(permissionRole.permission_role_id, user.permission_role_id)
      )
      .innerJoin(userDocument, eq(userDocument.user_id, user.user_id))
      .innerJoin(
        userDocumentType,
        eq(
          userDocumentType.user_document_type_id,
          userDocument.user_document_type_id
        )
      )
      .leftJoin(userAddress, eq(userAddress.user_id, user.user_id))
      .where(
        and(
          or(eq(user.username, input.username), eq(user.email, input.email)),
          eq(user.password, input.password),
          eq(user.user_status_id, EUserStatus.active),
          isNull(user.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0] as AuthUserResponse;
  };
}
