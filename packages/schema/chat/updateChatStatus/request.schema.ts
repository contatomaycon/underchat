import { EChatStatus } from '@core/common/enums/EChatStatus';
import { Static, Type } from '@sinclair/typebox';

export const updateChatStatusParamsSchema = Type.Object({
  chat_id: Type.String(),
});

export const updateChatStatusBodySchema = Type.Object({
  status: Type.String({ enum: Object.values(EChatStatus) }),
  send_message_on_finish_attendance: Type.Optional(Type.Boolean()),
});

export type UpdateChatStatusParams = Static<
  typeof updateChatStatusParamsSchema
>;
export type UpdateChatStatusBody = Static<typeof updateChatStatusBodySchema>;
