import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { Static, Type } from '@sinclair/typebox';

export const updateChatsUserRequestSchema = Type.Object({
  about: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(Type.String({ enum: Object.values(EChatUserStatus) })),
  notifications: Type.Boolean(),
});

export type UpdateChatsUserRequest = Static<
  typeof updateChatsUserRequestSchema
>;
