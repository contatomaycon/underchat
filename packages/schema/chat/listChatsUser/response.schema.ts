import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { Static, Type } from '@sinclair/typebox';

export const listChatsUserResponseSchema = Type.Object({
  chat_user_id: Type.String(),
  about: Type.Union([Type.String(), Type.Null()]),
  status: Type.String({ enum: Object.values(EChatUserStatus) }),
  notifications: Type.Boolean(),
});

export type ListChatsUserResponse = Static<typeof listChatsUserResponseSchema>;
