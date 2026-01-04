import { Static, Type } from '@sinclair/typebox';

export const updateTransferProtocolTextResponseSchema = Type.Object({
  generate_protocol_at_transfer: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type UpdateTransferProtocolTextResponse = Static<
  typeof updateTransferProtocolTextResponseSchema
>;
