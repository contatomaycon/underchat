import { Static, Type } from '@sinclair/typebox';

export const updateTransferProtocolTextParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateTransferProtocolTextRequestSchema = Type.Object({
  text: Type.Optional(Type.String({ maxLength: 2000 })),
});

export type UpdateTransferProtocolTextParams = Static<
  typeof updateTransferProtocolTextParamsSchema
>;
export type UpdateTransferProtocolTextRequest = Static<
  typeof updateTransferProtocolTextRequestSchema
>;
