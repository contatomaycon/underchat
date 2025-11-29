import { Static, Type } from '@sinclair/typebox';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

export const chatboxUserResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  status: Type.Optional(
    Type.Union([
      Type.String({ enum: Object.values(EChatUserStatus) }),
      Type.Null(),
    ])
  ),
});

export type ChatboxUserResponse = Static<typeof chatboxUserResponseSchema>;

export const listChatboxUsersResponseSchema = Type.Array(
  chatboxUserResponseSchema
);

export type ListChatboxUsersResponse = Static<
  typeof listChatboxUsersResponseSchema
>;
