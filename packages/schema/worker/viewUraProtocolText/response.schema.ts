import { Static, Type } from '@sinclair/typebox';

export const viewUraProtocolTextResponseSchema = Type.Object({
  generate_protocol_at_ura: Type.Union([Type.String(), Type.Null()]),
});

export type ViewUraProtocolTextResponse = Static<
  typeof viewUraProtocolTextResponseSchema
>;
