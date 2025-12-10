import { Static, Type } from '@sinclair/typebox';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

export const chatbotSectorUserResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(
    Type.Union([
      Type.String({ enum: Object.values(EChatUserStatus) }),
      Type.Null(),
    ])
  ),
});

export type ChatbotSectorUserResponse = Static<
  typeof chatbotSectorUserResponseSchema
>;

export const listChatbotSectorUsersResponseSchema = Type.Array(
  chatbotSectorUserResponseSchema
);

export type ListChatbotSectorUsersResponse = Static<
  typeof listChatbotSectorUsersResponseSchema
>;
