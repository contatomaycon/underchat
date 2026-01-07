import { Static, Type } from '@sinclair/typebox';

export const viewTransferProtocolSectorAndUserTextResponseSchema = Type.Object({
  generate_protocol_at_transfer_sector_and_user: Type.Union([
    Type.String(),
    Type.Null(),
  ]),
  enabled: Type.Boolean(),
});

export type ViewTransferProtocolSectorAndUserTextResponse = Static<
  typeof viewTransferProtocolSectorAndUserTextResponseSchema
>;
