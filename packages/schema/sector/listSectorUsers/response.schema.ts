import { Static, Type } from '@sinclair/typebox';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

export const listSectorUsersResponseSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
  email_partial: Type.String(),
  user_info: Type.Optional(
    Type.Object({
      name: Type.Optional(Type.String()),
      last_name: Type.Optional(Type.String()),
    })
  ),
  chat_user: Type.Optional(
    Type.Object({
      status: Type.Optional(
        Type.Union([
          Type.String({ enum: Object.values(EChatUserStatus) }),
          Type.Null(),
        ])
      ),
    })
  ),
});

export type ListSectorUsersResponse = Static<
  typeof listSectorUsersResponseSchema
>;
