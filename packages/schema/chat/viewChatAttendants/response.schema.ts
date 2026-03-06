import { Static, Type } from '@sinclair/typebox';

export const chatAttendantInfoSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  entered_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const viewChatAttendantsResponseSchema = Type.Object({
  primary_user: Type.Union([chatAttendantInfoSchema, Type.Null()]),
  secondary_users: Type.Array(chatAttendantInfoSchema),
});

export type ChatAttendantInfo = Static<typeof chatAttendantInfoSchema>;
export type ViewChatAttendantsResponse = Static<
  typeof viewChatAttendantsResponseSchema
>;
