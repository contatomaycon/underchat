import { Static, Type } from '@sinclair/typebox';

export const updateShowMessageOnCallResponseSchema = Type.Object({
  show_message_on_call: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type UpdateShowMessageOnCallResponse = Static<
  typeof updateShowMessageOnCallResponseSchema
>;
