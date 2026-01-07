import { Static, Type } from '@sinclair/typebox';

export const updateTransferProtocolSectorTextParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateTransferProtocolSectorTextRequestSchema = Type.Object({
  text: Type.Optional(Type.String({ maxLength: 2000 })),
  enabled: Type.Boolean(),
});

export type UpdateTransferProtocolSectorTextParams = Static<
  typeof updateTransferProtocolSectorTextParamsSchema
>;
export type UpdateTransferProtocolSectorTextRequest = Static<
  typeof updateTransferProtocolSectorTextRequestSchema
>;
