import { Static, Type } from '@sinclair/typebox';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

export const chatbotUserResponseSchema = Type.Object({
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

export type ChatbotUserResponse = Static<typeof chatbotUserResponseSchema>;

export const listChatbotUsersResponseSchema = Type.Array(
  chatbotUserResponseSchema
);

export type ListChatbotUsersResponse = Static<
  typeof listChatbotUsersResponseSchema
>;
