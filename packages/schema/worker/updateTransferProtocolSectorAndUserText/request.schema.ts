import { Static, Type } from '@sinclair/typebox';

export const updateTransferProtocolSectorAndUserTextParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateTransferProtocolSectorAndUserTextRequestSchema = Type.Object(
  {
    text: Type.Optional(Type.String({ maxLength: 2000 })),
    enabled: Type.Boolean(),
  }
);

export type UpdateTransferProtocolSectorAndUserTextParams = Static<
  typeof updateTransferProtocolSectorAndUserTextParamsSchema
>;
export type UpdateTransferProtocolSectorAndUserTextRequest = Static<
  typeof updateTransferProtocolSectorAndUserTextRequestSchema
>;
