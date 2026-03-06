import { Static, Type } from '@sinclair/typebox';

export const viewChatAttendantsParamsSchema = Type.Object({
  chat_id: Type.String(),
});

export type ViewChatAttendantsParams = Static<
  typeof viewChatAttendantsParamsSchema
>;
