import { Static, Type } from '@sinclair/typebox';

export const viewTransferProtocolTextResponseSchema = Type.Object({
  generate_protocol_at_transfer: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type ViewTransferProtocolTextResponse = Static<
  typeof viewTransferProtocolTextResponseSchema
>;
