import { Static, Type } from '@sinclair/typebox';

export const updateStartProtocolTextResponseSchema = Type.Object({
  generate_protocol_at_start: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type UpdateStartProtocolTextResponse = Static<
  typeof updateStartProtocolTextResponseSchema
>;
