import { Static, Type } from '@sinclair/typebox';

export const viewStartProtocolTextResponseSchema = Type.Object({
  generate_protocol_at_start: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type ViewStartProtocolTextResponse = Static<
  typeof viewStartProtocolTextResponseSchema
>;
