import { Static, Type } from '@sinclair/typebox';

export const updateTransferProtocolSectorTextResponseSchema = Type.Object({
  generate_protocol_at_transfer_sector: Type.Union([
    Type.String(),
    Type.Null(),
  ]),
  enabled: Type.Boolean(),
});

export type UpdateTransferProtocolSectorTextResponse = Static<
  typeof updateTransferProtocolSectorTextResponseSchema
>;
