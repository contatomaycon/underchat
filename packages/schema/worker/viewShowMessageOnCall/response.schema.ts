import { Static, Type } from '@sinclair/typebox';

export const viewShowMessageOnCallResponseSchema = Type.Object({
  show_message_on_call: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type ViewShowMessageOnCallResponse = Static<
  typeof viewShowMessageOnCallResponseSchema
>;
