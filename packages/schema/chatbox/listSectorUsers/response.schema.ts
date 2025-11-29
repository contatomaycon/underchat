import { Static, Type } from '@sinclair/typebox';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

export const chatboxSectorUserResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  status: Type.Optional(
    Type.Union([
      Type.String({ enum: Object.values(EChatUserStatus) }),
      Type.Null(),
    ])
  ),
});

export type ChatboxSectorUserResponse = Static<
  typeof chatboxSectorUserResponseSchema
>;

export const listChatboxSectorUsersResponseSchema = Type.Array(
  chatboxSectorUserResponseSchema
);

export type ListChatboxSectorUsersResponse = Static<
  typeof listChatboxSectorUsersResponseSchema
>;
