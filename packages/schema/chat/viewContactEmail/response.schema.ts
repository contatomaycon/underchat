import { Static, Type } from '@sinclair/typebox';

export const viewChatContactEmailResponseSchema = Type.Object({
  email: Type.Union([Type.String(), Type.Null()]),
});

export type ViewChatContactEmailResponse = Static<
  typeof viewChatContactEmailResponseSchema
>;
