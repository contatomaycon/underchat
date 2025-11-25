import { Static, Type } from '@sinclair/typebox';

export const updateUraProtocolTextResponseSchema = Type.Object({
  generate_protocol_at_ura: Type.Union([Type.String(), Type.Null()]),
});

export type UpdateUraProtocolTextResponse = Static<
  typeof updateUraProtocolTextResponseSchema
>;
